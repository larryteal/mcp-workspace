import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpHandler } from 'agents/mcp';
import { z } from 'zod';
import type { Env } from '../env';
import { substitutePayload } from '../utils/template';
import { executeHttpRequest } from '../utils/httpExecutor';

const mcp = new Hono<{ Bindings: Env }>();

// Frontend data types (stored as JSON in DB)
interface KeyValueItem {
  enabled: boolean;
  key: string;
  value: string;
}

interface Tool {
  id: string;
  name: string;
  description: string;
  method: string;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  cookies: KeyValueItem[];
  bodyType: string;
  bodyContent: string;
  bodyUrlEncoded: KeyValueItem[];
  inputSchema: string;
}

interface MCPService {
  id: string;
  name: string;
  version: string;
  description: string;
  tools: Tool[];
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

/**
 * Load workspace data from DB by wid_hash (MD5 of workspace ID)
 */
async function getWorkspaceDataByHash(db: D1Database, widHash: string): Promise<MCPService[]> {
  const row = await db
    .prepare('SELECT data FROM workspaces WHERE wid_hash = ?')
    .bind(widHash)
    .first<{ data: string }>();

  if (!row) return [];

  try {
    return JSON.parse(row.data) as MCPService[];
  } catch {
    return [];
  }
}

/**
 * Build an McpServer for a specific workspace service.
 * @param widHash - MD5 hash of workspace ID (used in MCP URLs for security)
 * @param clientHeaders - Headers from MCP client request, will be merged with tool config headers (client headers take priority)
 */
async function buildMcpServer(
  db: D1Database,
  widHash: string,
  serviceId: string,
  clientHeaders: Record<string, string>,
): Promise<McpServer | null> {
  const services = await getWorkspaceDataByHash(db, widHash);
  const svc = services.find((s) => s.id === serviceId);
  if (!svc) return null;

  const server = new McpServer({
    name: svc.name || serviceId,
    version: svc.version || '1.0.0',
  });

  for (const tool of svc.tools) {
    // Convert JSON Schema string to Zod schema
    let inputSchema: z.ZodTypeAny | undefined;
    if (tool.inputSchema) {
      try {
        const jsonSchema = JSON.parse(tool.inputSchema);
        inputSchema = z.fromJSONSchema(jsonSchema);
      } catch {
        // Invalid schema, leave undefined
      }
    }

    server.registerTool(tool.name || tool.id, {
      description: tool.description || undefined,
      inputSchema,
    }, async (args) => {
      // Merge headers: tool config headers first, then client headers override
      const toolHeaders = kvToRecord(tool.headers) ?? {};
      const mergedHeaders = { ...toolHeaders, ...clientHeaders };

      // Build body payload
      let bodyPayload: string | Record<string, string> | null = null;
      if (tool.bodyType === 'raw-json' && tool.bodyContent) {
        bodyPayload = tool.bodyContent;
      } else if (tool.bodyType === 'x-www-form-urlencoded') {
        bodyPayload = kvToRecord(tool.bodyUrlEncoded);
      }

      const rawConfig = {
        url: tool.url,
        params: kvToRecord(tool.params),
        headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : null,
        cookies: kvToRecord(tool.cookies),
        body: {
          type: tool.bodyType,
          payload: bodyPayload,
        },
      };

      const values = args as Record<string, string>;
      const resolved = substitutePayload(rawConfig, values);

      try {
        const result = await executeHttpRequest({
          method: tool.method,
          ...resolved,
        });

        let text: string;
        try {
          const parsed = JSON.parse(result.body);
          text = JSON.stringify(parsed, null, 2);
        } catch {
          text = result.body;
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Request failed';
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    });
  }

  return server;
}

// Headers that should NOT be forwarded from MCP client to upstream API
const EXCLUDED_HEADERS = new Set([
  'host',
  'content-length',
  'content-type',
  'accept',
  'accept-encoding',
  'accept-language',
  'connection',
  'mcp-session-id',
  'mcp-protocol-version',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
]);

// All methods on /workspace/:widHash/mcp/:serviceId — Streamable HTTP
// Note: widHash is MD5 hash of workspace ID (for security - prevents inferring edit URL from MCP URL)
mcp.all('/:widHash/mcp/:serviceId', async (c) => {
  const widHash = c.req.param('widHash')!;
  const serviceId = c.req.param('serviceId')!;

  // Extract client headers (excluding protocol/transport headers)
  const clientHeaders: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (!EXCLUDED_HEADERS.has(lowerKey)) {
      clientHeaders[key] = value;
    }
  });

  const server = await buildMcpServer(c.env.DB, widHash, serviceId, clientHeaders);
  if (!server) {
    return c.json({ error: `Service "${serviceId}" not found` }, 404);
  }

  const route = `/workspace/${widHash}/mcp/${serviceId}`;
  const handler = createMcpHandler(server, {
    route,
    sessionIdGenerator: undefined, // stateless — no session tracking
    corsOptions: {
      origin: '*',
      methods: 'GET, POST, DELETE, OPTIONS',
      headers: 'Content-Type, mcp-session-id, mcp-protocol-version',
    },
  });

  return handler(c.req.raw, c.env, c.executionCtx);
});

export default mcp;
