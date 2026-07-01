/**
 * Build and execute an HTTP request from a tool configuration.
 * Returns a structured response with timing info.
 */
export interface ExecuteResult {
  status: number;
  statusText: string;
  time: number;
  size: string;
  headers: Record<string, string>;
  cookies: Array<{ key: string; value: string }>;
  /** Response body. Plain text when `encoding === 'text'`, base64 when `encoding === 'base64'`. */
  body: string;
  /** How `body` is encoded. */
  encoding: 'text' | 'base64';
  /** Response MIME type (content-type without parameters), lowercased; '' when absent. */
  mimeType: string;
}

// Maximum response size we will buffer and return (10 MB). base64 inflates by
// ~33% and the Workers runtime has memory/response-size limits, so bound it.
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

// Abort an upstream request that takes longer than this, so a slow/hanging
// upstream can't tie up the request indefinitely.
const REQUEST_TIMEOUT_MS = 30_000;

export async function executeHttpRequest(config: {
  method: string;
  url: string;
  params: Record<string, string> | null;
  headers: Record<string, string> | null;
  cookies: Record<string, string> | null;
  body: { type: string; payload: string | Record<string, string> | null };
  /**
   * Whether requests to internal hosts (localhost/loopback AND private/link-local
   * ranges) are permitted. Defaults to false (deny) so the safe behavior is the
   * default; callers pass `true` only in the local dev environment. See
   * `isInternalHost`.
   */
  allowInternalHosts?: boolean;
}): Promise<ExecuteResult> {
  // Build URL with query params
  // URL may already contain query params (e.g., https://api.example.com/data?key=123)
  // Config params will override URL params with the same key
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error(`Invalid URL: ${config.url}`);
  }

  // Internal-host guard: outside local dev, refuse to proxy to localhost/loopback
  // or private/link-local ranges so a configured tool can't make the server reach
  // internal services or cloud metadata. Redirects are forbidden (fetch
  // redirect:'error' below), so this initial-URL check can't be bypassed by a
  // redirect. Residual gap: a DNS name that resolves to an internal IP is not
  // caught (no resolution here) — best-effort, not airtight SSRF.
  if (!config.allowInternalHosts && isInternalHost(url.hostname)) {
    throw new Error(`Requests to internal/private addresses are not allowed in this environment: ${url.hostname}`);
  }

  if (config.params) {
    for (const [k, v] of Object.entries(config.params)) {
      // Use set() to override any existing param with the same key from the URL
      url.searchParams.set(k, v);
    }
  }

  // Build headers
  const headers = new Headers();
  if (config.headers) {
    for (const [k, v] of Object.entries(config.headers)) {
      headers.set(k, v);
    }
  }

  // Add cookies as Cookie header
  if (config.cookies) {
    const cookieStr = Object.entries(config.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    headers.set('Cookie', cookieStr);
  }

  // Build body
  // GET/HEAD requests cannot carry a body — fetch() throws if one is supplied.
  // Silently drop any configured body for these methods rather than failing the
  // whole request with an opaque "Upstream request failed".
  const method = (config.method || 'GET').toUpperCase();
  const methodAllowsBody = method !== 'GET' && method !== 'HEAD';
  let requestBody: BodyInit | undefined;
  if (methodAllowsBody && config.body.type !== 'none' && config.body.payload !== null) {
    switch (config.body.type) {
      case 'raw-json':
        // Only default the Content-Type when the user hasn't set one of their
        // own (e.g. `application/json; charset=utf-8` or a vendor type), so an
        // explicit header is preserved rather than clobbered. Headers.has is
        // case-insensitive.
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        requestBody = config.body.payload as string;
        break;
      // Note: 'form-data' is disabled in frontend, not supported here
      case 'x-www-form-urlencoded': {
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/x-www-form-urlencoded');
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(config.body.payload as Record<string, string>)) {
          params.append(k, v);
        }
        requestBody = params.toString();
        break;
      }
    }
  }

  const start = Date.now();
  const response = await fetch(url.toString(), {
    method,
    headers,
    body: requestBody,
    // Forbid redirects: the internal-host guard only validates the initial URL,
    // so following a redirect could reach an internal host the guard rejected
    // (e.g. an external URL returning 302 → http://10.0.0.5). `error` makes a
    // redirect response throw, which maps to the generic upstream error.
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const elapsed = Date.now() - start;

  // Guard against oversized responses: reject early on a declared length...
  const declaredLen = response.headers.get('content-length');
  if (declaredLen && Number(declaredLen) > MAX_RESPONSE_BYTES) {
    throw new Error(`Response too large: ${declaredLen} bytes (max ${MAX_RESPONSE_BYTES})`);
  }

  // ...and stream-read with a hard cap so an oversized or unbounded (chunked,
  // no Content-Length) response is aborted mid-stream instead of being fully
  // buffered into memory. Never use response.text() — it UTF-8 decodes and
  // irreversibly corrupts binary payloads (images, PDFs, ...).
  const buf = await readBodyCapped(response, MAX_RESPONSE_BYTES);

  const contentType = response.headers.get('content-type') ?? '';
  const mimeType = contentType.split(';')[0].trim().toLowerCase();

  let body: string;
  let encoding: 'text' | 'base64';
  if (isTextualResponse(mimeType, buf)) {
    body = decodeText(buf, contentType);
    encoding = 'text';
  } else {
    body = bytesToBase64(new Uint8Array(buf));
    encoding = 'base64';
  }

  // Extract response headers
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  // Extract cookies from Set-Cookie. getSetCookie() returns each Set-Cookie
  // header as its own entry, so we must NOT split on ',' (which would corrupt
  // cookies whose attributes contain commas, e.g. `Expires=Wed, 09 Jun 2021`).
  // Fall back to a single-entry get() for runtimes lacking getSetCookie().
  const responseCookies: Array<{ key: string; value: string }> = [];
  // getSetCookie() exists at runtime (Workers/undici) but isn't in the Headers
  // type here; feature-detect through a typed view to stay type-safe.
  const respHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof respHeaders.getSetCookie === 'function'
      ? respHeaders.getSetCookie()
      : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')!] : []);
  for (const cookie of setCookies) {
    const trimmed = cookie.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx);
      const semiIdx = trimmed.indexOf(';', eqIdx);
      const value = semiIdx > 0 ? trimmed.substring(eqIdx + 1, semiIdx) : trimmed.substring(eqIdx + 1);
      responseCookies.push({ key, value });
    }
  }

  return {
    status: response.status,
    statusText: response.statusText,
    time: elapsed,
    size: formatBytes(buf.byteLength),
    headers: responseHeaders,
    cookies: responseCookies,
    body,
    encoding,
    mimeType,
  };
}

/** Whether an IPv4 dotted-quad string is in a loopback/private/link-local range. */
function isPrivateIPv4(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT 100.64/10
  return false;
}

/**
 * Whether a URL hostname refers to an internal target: localhost/loopback, the
 * unspecified address, private and link-local IPv4 ranges, IPv6 loopback,
 * link-local (fe80::/10) and unique-local (fc00::/7), and IPv4-mapped IPv6 forms
 * of any of the above. Used to block such targets outside local dev.
 * Best-effort: validates the literal hostname only (no DNS resolution / redirect
 * re-checking) — see the call site.
 */
function isInternalHost(hostname: string): boolean {
  let h = hostname.toLowerCase();
  // URL.hostname keeps brackets around IPv6 literals (e.g. "[::1]"); strip them.
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  // Strip a trailing dot (fully-qualified form): "localhost." resolves to
  // localhost but would otherwise dodge the string checks below.
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h === 'localhost' || h.endsWith('.localhost')) return true;

  if (h.includes(':')) {
    // IPv6 literal.
    if (h === '::1' || h === '::') return true;
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // unique-local fc00::/7
    if (h.startsWith('::ffff:')) {
      const mapped = h.slice('::ffff:'.length);
      if (isPrivateIPv4(mapped)) return true; // dotted form ::ffff:127.0.0.1
      // hex form ::ffff:7f00:1 → reconstruct the IPv4 and re-check.
      const hm = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mapped);
      if (hm) {
        const hi = parseInt(hm[1], 16);
        const lo = parseInt(hm[2], 16);
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        if (isPrivateIPv4(ipv4)) return true;
      }
    }
    return false;
  }

  // IPv4 dotted-quad (domains fall through to false).
  return isPrivateIPv4(h);
}

/**
 * Decide whether a response should be treated as text (vs binary).
 * Binary media families (image/audio/video) go through the binary path, except
 * image/svg+xml which is XML text. When there is no Content-Type we sniff bytes.
 */
function isTextualResponse(mime: string, buf: ArrayBuffer): boolean {
  if (mime) {
    if (mime === 'image/svg+xml') return true; // SVG is XML text, not binary media
    if (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')) {
      return false;
    }
    if (mime.startsWith('text/')) return true;
    if (
      mime === 'application/json' ||
      mime === 'application/xml' ||
      mime === 'application/javascript' ||
      mime === 'application/ecmascript' ||
      mime === 'application/x-www-form-urlencoded' ||
      mime === 'application/x-ndjson' ||
      mime === 'application/yaml' ||
      mime === 'application/x-yaml'
    ) {
      return true;
    }
    if (mime.endsWith('+json') || mime.endsWith('+xml')) return true;
    return false; // application/octet-stream, application/pdf, application/zip, fonts, ...
  }
  return sniffTextual(buf);
}

/** Heuristic for responses with no Content-Type: NUL byte or invalid UTF-8 → binary. */
function sniffTextual(buf: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Decode text honoring the response charset (defaults to / falls back to UTF-8). */
function decodeText(buf: ArrayBuffer, contentType: string): string {
  const m = /charset=([^;]+)/i.exec(contentType);
  const charset = m ? m[1].trim().replace(/^["']|["']$/g, '') : 'utf-8';
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/**
 * Read a response body into an ArrayBuffer, aborting if it exceeds `max` bytes.
 * Streams chunk-by-chunk and cancels mid-flight on overflow, so an oversized or
 * unbounded (no Content-Length) response is never fully buffered into memory.
 */
async function readBodyCapped(response: Response, max: number): Promise<ArrayBuffer> {
  const body = response.body;
  if (!body) return new ArrayBuffer(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new Error(`Response too large: exceeds ${max} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    // Don't let a releaseLock failure mask the original error (e.g. "too large").
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/** Base64-encode bytes in chunks (no Node Buffer in Workers; avoid arg-count overflow). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // 32 KB
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
