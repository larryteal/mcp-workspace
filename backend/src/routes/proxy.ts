import { Hono } from 'hono';
import type { Env } from '../env';
import { executeHttpRequest } from '../utils/httpExecutor';

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

/** Convert KeyValueItem[] to Record<string, string> (only enabled items with non-empty keys) */
function kvToRecord(items: KeyValueItem[]): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const item of items) {
    if (item.enabled && item.key.trim()) {
      result[item.key] = item.value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

// POST /api/workspace/:wid/proxy/test
proxy.post('/test', async (c) => {
  const tool = await c.req.json<ToolPayload>();

  if (!tool.url) {
    return c.json({ error: 'URL is required' }, 400);
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
      },
      502,
    );
  }
});

export default proxy;
