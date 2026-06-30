import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpHandler } from 'agents/mcp';
import { z } from 'zod';
import type { Env } from '../env';
import { substitutePayload } from '../utils/template';
import { executeHttpRequest, type ExecuteResult } from '../utils/httpExecutor';
import { compileSchema } from '../utils/schema';

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
  outputSchema: string;
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
    const parsed = JSON.parse(row.data);
    // Stored value must be an array of services; anything else is treated as empty.
    return Array.isArray(parsed) ? (parsed as MCPService[]) : [];
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
  // Guard against null/non-object array elements (legacy/hand-written data):
  // `s.id` on a null element would throw and 500 the whole endpoint.
  const svc = services.find((s) => s && s.id === serviceId);
  if (!svc) return null;

  const server = new McpServer({
    name: svc.name || serviceId,
    version: svc.version || '1.0.0',
  });

  const registeredNames = new Set<string>();
  const toolList = Array.isArray(svc.tools) ? svc.tools : [];

  for (const tool of toolList) {
    // Per-tool isolation: a single bad tool must never take down the whole
    // service (which would break initialize/tools/list for every other tool).
    let toolName: string | undefined;
    try {
      toolName = tool?.name || tool?.id;
      if (!toolName) {
        console.error(`[mcp] skipping tool with no name/id in service ${serviceId}`);
        continue;
      }
      // MCP identifies tools by name; a duplicate would make registerTool throw.
      if (registeredNames.has(toolName)) {
        console.error(`[mcp] skipping duplicate tool name "${toolName}" in service ${serviceId}`);
        continue;
      }

      // Compile inputSchema/outputSchema to Zod (empty → none; same unified
      // rule as on save). A non-empty but invalid schema means stale/legacy
      // data: compileToolSchema throws and the per-tool catch below skips the
      // whole tool (fail-closed) rather than registering it unvalidated.
      const inputSchema = compileToolSchema(tool.inputSchema, 'inputSchema');
      const outputSchema = compileToolSchema(tool.outputSchema, 'outputSchema');
      const hasInputSchema = inputSchema !== undefined;
      const hasOutputSchema = outputSchema !== undefined;

      // toolName is narrowed to string after the guards above; capture it in a
      // const so the async closure below sees a non-undefined type.
      const name = toolName;
      server.registerTool(name, {
        description: tool.description || undefined,
        inputSchema,
        outputSchema,
      }, async (first) => {
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

        // The SDK passes (args, extra) when an inputSchema is registered, but
        // (extra) alone when it isn't. A tool with no inputSchema takes no
        // arguments, so use an empty map — never treat `extra` as arguments
        // (it would leak fields like sessionId into {{var}} substitution).
        const values = (hasInputSchema ? first : {}) as Record<string, unknown>;
        const resolved = substitutePayload(rawConfig, values);

        try {
          const result = await executeHttpRequest({
            method: tool.method,
            ...resolved,
          });
          return toToolResult(result, serviceId, name, hasOutputSchema);
        } catch (err) {
          // Upstream/transport failure is a tool execution error (isError per
          // spec). Keep technical detail (URL, size, network message) out of the
          // LLM context — log it for operators instead.
          console.error(`[mcp] tool "${name}" upstream request failed:`, err);
          return {
            content: [{ type: 'text' as const, text: 'Upstream request failed.' }],
            isError: true,
          };
        }
      });

      registeredNames.add(name);
    } catch (err) {
      console.error(`[mcp] skipping tool "${toolName ?? '?'}" in service ${serviceId}:`, err);
    }
  }

  return server;
}

/**
 * Compile a tool schema string (inputSchema or outputSchema) to a Zod schema.
 * Empty/whitespace → undefined (no schema). Non-empty but invalid → throws
 * (caller's per-tool catch skips the whole tool, fail-closed). Uses the same
 * unified rule as on save, so "valid on save" implies "usable here".
 * NOTE: the ZodObject from fromJSONSchema is accepted by the SDK
 * (normalizeObjectSchema handles "raw shapes and object schemas").
 */
function compileToolSchema(raw: string | undefined, field: string): z.ZodTypeAny | undefined {
  const { schema, error } = compileSchema(raw ?? '', field);
  if (error) throw new Error(error);
  return schema;
}

/**
 * Map an upstream HTTP response to an MCP tool result.
 * - Surfaces upstream HTTP errors (status >= 400) as isError (MCP spec:
 *   "Tool Execution Errors → isError: true").
 * - Binary responses → image/* | audio/* | embedded resource (blob).
 * - Text responses → returned verbatim (no reformatting).
 * - structuredContent is added only when the tool declares an outputSchema,
 *   the call succeeded, and the body parses to a JSON object; the SDK then
 *   strictly validates it against the outputSchema.
 */
function toToolResult(
  result: ExecuteResult,
  serviceId: string,
  toolName: string,
  hasOutputSchema: boolean,
) {
  const isError = result.status >= 400;

  // Binary → image/audio/resource; structuredContent does not apply. Note: if a
  // tool declares an outputSchema but the upstream returns binary, the SDK will
  // reject the result (no structuredContent) — outputSchema and binary output
  // are mutually exclusive by design.
  if (result.encoding === 'base64') {
    const content = [binaryContentBlock(result, serviceId, toolName)];
    return isError ? { content, isError: true } : { content };
  }

  // Text is returned verbatim (the spec does not require any reformatting; the
  // serialized JSON also doubles as the backward-compatible text block when
  // structuredContent is present).
  const content = [{ type: 'text' as const, text: result.body }];

  if (hasOutputSchema && !isError) {
    // Provide structuredContent for the SDK to validate against outputSchema.
    // If the body isn't a JSON object we deliberately omit it: the SDK then
    // reports the mismatch (tool declares object output, upstream returned
    // otherwise) instead of silently passing.
    try {
      const obj = JSON.parse(result.body);
      if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
        return { content, structuredContent: obj as Record<string, unknown> };
      }
    } catch {
      /* not JSON — leave structuredContent absent; SDK will flag it */
    }
  }

  return isError ? { content, isError: true } : { content };
}

function binaryContentBlock(result: ExecuteResult, serviceId: string, toolName: string) {
  if (result.body === '') {
    // Empty upstream body: return an empty text block (an empty image/resource
    // block would be invalid) without injecting any synthesized description.
    return { type: 'text' as const, text: '' };
  }
  const mime = result.mimeType || 'application/octet-stream';
  if (mime.startsWith('image/')) {
    return { type: 'image' as const, data: result.body, mimeType: mime };
  }
  if (mime.startsWith('audio/')) {
    return { type: 'audio' as const, data: result.body, mimeType: mime };
  }
  // video / pdf / zip / octet-stream / fonts / ... → embedded resource (blob).
  // MCP has no "video" content type; binary that isn't image/audio is a resource.
  return {
    type: 'resource' as const,
    resource: {
      uri: `mcp-proxy://${encodeURIComponent(serviceId)}/${encodeURIComponent(toolName)}`,
      mimeType: mime,
      blob: result.body,
    },
  };
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
    // Report a JSON-RPC top-level error over HTTP 200. JSON-RPC-over-HTTP
    // signals application/protocol errors in the body with a 2xx status; a
    // non-2xx (e.g. 404) is treated by many MCP clients as a transport failure,
    // so the structured error would be ignored. -32602 (Invalid params): the
    // request targets a service that does not exist — consistent with how the
    // SDK reports unknown tools / missing targets.
    // The request id is echoed when present; otherwise null per JSON-RPC.
    let id: string | number | null = null;
    try {
      const body = await c.req.json<{ id?: unknown }>();
      if (typeof body?.id === 'string' || typeof body?.id === 'number') {
        id = body.id;
      }
    } catch {
      // No/invalid JSON body (e.g. GET) — id stays null.
    }
    return c.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: `Service "${serviceId}" not found` },
    });
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
