import { Hono } from 'hono';
import type { Env } from '../env';

const services = new Hono<{ Bindings: Env }>();

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
    return c.json(JSON.parse(row.data));
  } catch {
    return c.json([]);
  }
});

// PUT /api/workspace/:wid/mcp-services/batch — full replace
services.put('/batch', async (c) => {
  const wid = c.req.param('wid')!;
  const { services: payload, widHash } = await c.req.json<{ services: unknown[]; widHash: string }>();

  const data = JSON.stringify(payload);

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
