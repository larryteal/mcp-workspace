import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Statuses that MUST NOT carry a body — the Response constructor throws otherwise.
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/**
 * Deterministic upstream for httpExecutor tests. All outbound fetch from the
 * test worker is routed here instead of the network, so tests are hermetic — yet
 * workerd's REAL fetch (including `redirect: 'manual'` handling) still runs
 * against these responses, so redirect behavior matches production.
 *
 * Routes (host is ignored):
 *   /status/:code          → that status, tiny text body (3xx carries a Location)
 *   /redirect-to-internal  → 302 whose Location points at cloud-metadata (SSRF)
 *   /json                  → 200 application/json {"ok":true}
 *   anything else          → 404
 */
function upstream(request: Request): Response {
  const { pathname } = new URL(request.url);
  const status = /^\/status\/(\d{3})$/.exec(pathname);
  if (status) {
    const code = Number(status[1]);
    // `new Response` throws (RangeError) for a status outside 200-599, which
    // would surface as an opaque outbound failure rather than the intended
    // status. Reject such routes loudly instead of letting the mock throw.
    if (code < 200 || code > 599) return unrouted(`status ${code} out of 200-599`);
    const body = NULL_BODY_STATUS.has(code) ? null : `body-${code}`;
    const headers: Record<string, string> = { 'content-type': 'text/plain' };
    // A real redirect carries Location; include it so the response is realistic.
    if (code >= 300 && code < 400) headers['location'] = 'https://upstream.test/json';
    return new Response(body, { status: code, headers });
  }
  // The exact SSRF the redirect refusal exists to stop: an allowed external URL
  // 302-ing to an internal host the initial-URL guard would have rejected.
  if (pathname === '/redirect-to-internal') {
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
  }
  if (pathname === '/json') {
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  // NOTE: this upstream is global to the whole vitest project (miniflare option),
  // so it answers EVERY outbound fetch from EVERY test file. An unrouted path is
  // almost certainly a typo/misconfigured test, so fail loudly (599 sentinel)
  // rather than returning a plausible 404 that could green a wrong test. When a
  // future suite needs a different upstream, split into per-suite vitest
  // `projects` rather than overloading this switchboard.
  return unrouted(`no route for ${pathname}`);
}

/** Distinctive, non-plausible response so a misrouted test fails its assertions. */
function unrouted(reason: string): Response {
  return new Response(`UNROUTED: ${reason}`, { status: 599, headers: { 'content-type': 'text/plain' } });
}

// Run tests inside workerd (the same runtime as `wrangler dev` / production) so
// runtime-specific behavior — global fetch's redirect handling, TextDecoder,
// btoa, ReadableStream, AbortSignal.timeout — matches deploy. Reuses the app's
// wrangler.jsonc (bindings, compatibility date/flags).
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { outboundService: upstream },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
