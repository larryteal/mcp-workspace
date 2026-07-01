import { describe, it, expect } from 'vitest';
import { executeHttpRequest } from '../src/utils/httpExecutor';

/**
 * Regression test for the redirect-refusal in `executeHttpRequest`.
 *
 * Why this matters: the internal-host SSRF guard only validates the INITIAL URL.
 * If upstream redirects were followed, an external URL could 302 → an internal
 * host (e.g. http://10.0.0.5 or cloud metadata) the guard rejected, bypassing it.
 * So redirects must be refused, never followed.
 *
 * Runtime note (locked here on purpose): Workers' fetch does NOT support
 * `redirect: 'error'` (throws "Invalid redirect value…"), so the code uses
 * `redirect: 'manual'` and rejects 3xx itself. These tests run inside workerd
 * (see vitest.config.ts) against a deterministic outboundService upstream, so
 * they confirm workerd surfaces the REAL 3xx status under 'manual' (not an
 * opaqueredirect with status 0) — the assumption the implementation depends on.
 * If a future workerd/SDK change breaks that assumption, these tests fail.
 */

const base = (path: string) => ({
  method: 'GET',
  url: `https://upstream.test${path}`,
  params: null,
  headers: null,
  cookies: null,
  body: { type: 'none' as const, payload: null },
});

describe('executeHttpRequest — redirect handling', () => {
  // The WHATWG "redirect status" codes. Each must be refused with a message that
  // surfaces the actual upstream status (proving workerd exposed the real 3xx).
  it.each([301, 302, 303, 307, 308])('refuses a %i redirect (never follows it)', async (code) => {
    await expect(executeHttpRequest(base(`/status/${code}`))).rejects.toThrow(
      new RegExp(`Redirects are not allowed \\(upstream returned ${code}\\)`),
    );
  });

  it('refuses an external → internal-host redirect (the SSRF this guards)', async () => {
    // The exact bypass the refusal exists to stop: an allowed external URL 302s
    // to a cloud-metadata IP the initial-URL guard rejects. Because we never
    // follow the redirect, this is refused at the 302 — the internal Location is
    // never fetched. If a future change follows redirects without per-hop host
    // validation, this test fails.
    await expect(executeHttpRequest(base('/redirect-to-internal'))).rejects.toThrow(
      /Redirects are not allowed \(upstream returned 302\)/,
    );
  });

  // 3xx codes that are NOT WHATWG redirects (300 Multiple Choices, 304 Not
  // Modified) are intentionally passed through, not refused. Locks that the
  // refusal is scoped to real redirects and doesn't over-block.
  it.each([300, 304])('passes through non-redirect 3xx %i', async (code) => {
    const r = await executeHttpRequest(base(`/status/${code}`));
    expect(r.status).toBe(code);
  });

  it('returns a normal 2xx response unchanged', async () => {
    const r = await executeHttpRequest(base('/json'));
    expect(r.status).toBe(200);
    expect(r.encoding).toBe('text');
    expect(r.mimeType).toBe('application/json');
    expect(r.body).toBe('{"ok":true}');
  });
});

describe('harness sanity — the refusal tests are not tautological', () => {
  // The whole suite's thesis ("we refuse redirects rather than follow them") is
  // only meaningful if this harness can DISTINGUISH following from not-following.
  // Prove workerd + the outboundService upstream actually follow a redirect under
  // redirect:'follow' (302 → its Location → /json 200). Since executeHttpRequest
  // uses redirect:'manual', a regression to 'follow' would make the /status/302
  // test resolve to this 200 body instead of throwing — so the suite above would
  // fail. If this canary ever stops following, the SSRF tests could silently pass
  // for the wrong reason, so lock the property here.
  it("workerd follows a 302 through outboundService under redirect:'follow'", async () => {
    const followed = await fetch('https://upstream.test/status/302', { redirect: 'follow' });
    expect(followed.status).toBe(200);
    expect(await followed.text()).toBe('{"ok":true}');

    const notFollowed = await fetch('https://upstream.test/status/302', { redirect: 'manual' });
    expect(notFollowed.status).toBe(302);
  });
});
