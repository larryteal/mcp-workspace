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
  body: string;
}

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

  const bodyText = await response.text();

  // Extract response headers
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  // Extract cookies from Set-Cookie
  const responseCookies: Array<{ key: string; value: string }> = [];
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    for (const part of setCookie.split(',')) {
      const trimmed = part.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx);
        const semiIdx = trimmed.indexOf(';', eqIdx);
        const value = semiIdx > 0 ? trimmed.substring(eqIdx + 1, semiIdx) : trimmed.substring(eqIdx + 1);
        responseCookies.push({ key, value });
      }
    }
  }

  return {
    status: response.status,
    statusText: response.statusText,
    time: elapsed,
    size: formatBytes(new TextEncoder().encode(bodyText).length),
    headers: responseHeaders,
    cookies: responseCookies,
    body: bodyText,
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
