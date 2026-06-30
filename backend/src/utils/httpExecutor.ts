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

export async function executeHttpRequest(config: {
  method: string;
  url: string;
  params: Record<string, string> | null;
  headers: Record<string, string> | null;
  cookies: Record<string, string> | null;
  body: { type: string; payload: string | Record<string, string> | null };
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
  let requestBody: BodyInit | undefined;
  if (config.body.type !== 'none' && config.body.payload !== null) {
    switch (config.body.type) {
      case 'raw-json':
        headers.set('Content-Type', 'application/json');
        requestBody = config.body.payload as string;
        break;
      // Note: 'form-data' is disabled in frontend, not supported here
      case 'x-www-form-urlencoded': {
        headers.set('Content-Type', 'application/x-www-form-urlencoded');
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
    method: config.method,
    headers,
    body: requestBody,
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
