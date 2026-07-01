import { Hono } from 'hono';
import type { Env } from '../env';
import { isDevEnvironment } from '../env';
import { executeHttpRequest } from '../utils/httpExecutor';
import { validateUrl, validateMethod, validateBodyType, validateKeyValueItems } from '../utils/validate';

const proxy = new Hono<{ Bindings: Env }>();

// Frontend data types
interface KeyValueItem {
  enabled: boolean;
  key: string;
  value: string;
}

interface ToolPayload {
  method: string;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  cookies: KeyValueItem[];
  bodyType: string;
  bodyContent: string;
  bodyUrlEncoded: KeyValueItem[];
}

/** Convert KeyValueItem[] to Record<string, string> (only enabled items with
 * non-empty keys). Defensive against a missing/non-array field or ill-typed rows. */
function kvToRecord(items: KeyValueItem[] | undefined | null): Record<string, string> | null {
  const result: Record<string, string> = {};
  if (Array.isArray(items)) {
    for (const item of items) {
      if (item && item.enabled && typeof item.key === 'string' && item.key.trim()) {
        result[item.key] = typeof item.value === 'string' ? item.value : '';
      }
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

// POST /api/workspace/:wid/proxy/test
proxy.post('/test', async (c) => {
  let tool: ToolPayload;
  try {
    tool = await c.req.json<ToolPayload>();
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  // Validate the request fields server-side: this endpoint executes an HTTP
  // request on the server, so a crafted payload hitting it directly must not
  // bypass the same checks applied on save.
  const urlErr = validateUrl(tool.url, 'URL');
  if (urlErr) return c.json({ error: urlErr }, 400);
  // method/bodyType default when absent (see executeHttpRequest call below).
  const methodErr = tool.method ? validateMethod(tool.method, 'method') : null;
  if (methodErr) return c.json({ error: methodErr }, 400);
  const bodyTypeErr = validateBodyType(tool.bodyType, 'bodyType');
  if (bodyTypeErr) return c.json({ error: bodyTypeErr }, 400);
  // Same KV field rules as the save path (parity).
  for (const [items, label] of [
    [tool.params, 'params'],
    [tool.headers, 'headers'],
    [tool.cookies, 'cookies'],
    [tool.bodyUrlEncoded, 'bodyUrlEncoded'],
  ] as const) {
    const kvErr = validateKeyValueItems(items, label);
    if (kvErr) return c.json({ error: kvErr }, 400);
  }

  // Build body payload
  let bodyPayload: string | Record<string, string> | null = null;
  if (tool.bodyType === 'raw-json' && tool.bodyContent) {
    bodyPayload = tool.bodyContent;
  } else if (tool.bodyType === 'x-www-form-urlencoded') {
    bodyPayload = kvToRecord(tool.bodyUrlEncoded);
  }

  try {
    const result = await executeHttpRequest({
      method: tool.method || 'GET',
      url: tool.url,
      params: kvToRecord(tool.params),
      headers: kvToRecord(tool.headers),
      cookies: kvToRecord(tool.cookies),
      body: { type: tool.bodyType || 'none', payload: bodyPayload },
      allowInternalHosts: isDevEnvironment(c.env),
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy request failed';
    return c.json(
      {
        status: 0,
        statusText: message,
        time: 0,
        size: '0 B',
        headers: {},
        cookies: [],
        body: '',
        encoding: 'text' as const,
        mimeType: '',
      },
      502,
    );
  }
});

export default proxy;
