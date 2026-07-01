import { Hono } from 'hono';
import type { Env } from '../env';
import { validateSchemaString } from '../utils/schema';
import { validateName, validateText, validateTool, LIMITS } from '../utils/validate';
import { md5 } from '../utils/md5';

const services = new Hono<{ Bindings: Env }>();

// Maximum serialized payload size for a single workspace save (1 MB).
// Workspace data is configuration (services/tools as JSON), so this is generous
// while still bounding how much a single request can write.
const MAX_PAYLOAD_BYTES = 1_000_000;

// GET /api/workspace/:wid/mcp-services
services.get('/', async (c) => {
  const wid = c.req.param('wid')!;
  const row = await c.env.DB
    .prepare('SELECT data FROM workspaces WHERE id = ?')
    .bind(wid)
    .first<{ data: string }>();

  if (!row) {
    return c.json([]);
  }

  try {
    const parsed = JSON.parse(row.data);
    // Always return an array, even if the stored value is malformed JSON object.
    return c.json(Array.isArray(parsed) ? parsed : []);
  } catch {
    return c.json([]);
  }
});

/**
 * Validate an untrusted save payload: field formats/lengths, tool-name
 * uniqueness, and inputSchema/outputSchema. Defensive throughout — the payload
 * shape itself is not trusted. Field rules live in utils/validate.ts and are
 * mirrored on the frontend.
 *
 * @returns null when the whole payload is valid; otherwise the first error.
 */
function validatePayload(servicesPayload: unknown[]): string | null {
  const serviceIds = new Set<string>();
  for (let i = 0; i < servicesPayload.length; i++) {
    const svc = servicesPayload[i];
    if (typeof svc !== 'object' || svc === null) {
      return `services[${i}] must be an object`;
    }
    const s = svc as { id?: unknown; name?: unknown; version?: unknown; description?: unknown; tools?: unknown };

    // Duplicate service ids make all but the first silently unreachable at the
    // MCP endpoint (services.find by id) — reject, matching the frontend check.
    if (typeof s.id === 'string' && s.id) {
      if (serviceIds.has(s.id)) {
        return `services[${i}] duplicate service id '${s.id}'`;
      }
      serviceIds.add(s.id);
    }

    // Service-level fields.
    const nameErr = validateName(s.name, `services[${i}].name`);
    if (nameErr) return nameErr;
    const versionErr = validateText(s.version, `services[${i}].version`);
    if (versionErr) return versionErr;
    const svcDescErr = validateText(s.description, `services[${i}].description`);
    if (svcDescErr) return svcDescErr;

    const tools = s.tools;
    if (tools === undefined || tools === null) continue; // a service with no tools is fine
    if (!Array.isArray(tools)) {
      return `services[${i}].tools must be an array`;
    }
    const toolNameKeys = new Set<string>();
    const toolIds = new Set<string>();
    for (let j = 0; j < tools.length; j++) {
      const tool = tools[j];
      if (typeof tool !== 'object' || tool === null) {
        return `services[${i}].tools[${j}] must be an object`;
      }
      const t = tool as { name?: unknown; id?: unknown; inputSchema?: unknown; outputSchema?: unknown };
      const where = `services[${i}].tools[${j}]`;

      // Non-schema fields (name, url, method, bodyType, text, KV) — shared with
      // the frontend's validateTool so both ends apply the identical rule set.
      const toolErr = validateTool(tool, where);
      if (toolErr) return toolErr;

      // MCP identifies tools by name; the runtime dedups on (name || id) and
      // silently drops repeats, so reject duplicates on save (defensive: the
      // shape is untrusted, so coerce non-string name/id to '').
      const rawName = typeof t.name === 'string' ? t.name : '';
      const rawId = typeof t.id === 'string' ? t.id : '';
      const nameKey = rawName || rawId;
      if (nameKey) {
        if (toolNameKeys.has(nameKey)) {
          return `${where} duplicate tool name '${rawName}' (tool names must be unique within a service)`;
        }
        toolNameKeys.add(nameKey);
      }
      // Also reject duplicate tool ids (matches the frontend, and DirtyContext keys
      // per-tool state by id): a duplicate id isn't editable in the UI, so it would
      // otherwise strand the workspace as viewable-but-unsaveable.
      if (rawId) {
        if (toolIds.has(rawId)) {
          return `${where} duplicate tool id '${rawId}' (tool ids must be unique within a service)`;
        }
        toolIds.add(rawId);
      }

      // inputSchema/outputSchema: length (SCHEMA_MAX) then JSON-Schema validity.
      for (const field of ['inputSchema', 'outputSchema'] as const) {
        const v = t[field];
        if (v === undefined || v === null) continue; // empty/absent schema is allowed
        if (typeof v !== 'string') {
          return `${where}.${field} must be a string`;
        }
        const lenErr = validateText(v, `${where}.${field}`, LIMITS.SCHEMA_MAX);
        if (lenErr) return lenErr;
        const err = validateSchemaString(v, `${where}.${field}`);
        if (err) return err;
      }
    }
  }
  return null;
}

// PUT /api/workspace/:wid/mcp-services/batch — full replace
services.put('/batch', async (c) => {
  const wid = c.req.param('wid')!;

  let body: { services?: unknown };
  try {
    body = await c.req.json<{ services?: unknown }>();
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  const payload = body.services;
  if (!Array.isArray(payload)) {
    return c.json({ error: '`services` must be an array' }, 400);
  }

  const data = JSON.stringify(payload);
  if (new TextEncoder().encode(data).length > MAX_PAYLOAD_BYTES) {
    return c.json({ error: 'Payload too large' }, 413);
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  // Compute wid_hash server-side; never trust a client-supplied hash. This
  // prevents forging an MCP lookup key that doesn't correspond to this id.
  // Must match the frontend's md5(workspaceId) (see utils/md5.ts).
  const widHash = md5(wid);

  await c.env.DB
    .prepare(
      `INSERT INTO workspaces (id, data, wid_hash, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, wid_hash = excluded.wid_hash, updated_at = excluded.updated_at`
    )
    .bind(wid, data, widHash)
    .run();

  return c.json(payload);
});

export default services;
