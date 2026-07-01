import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from './env';
import services from './routes/services';
import proxy from './routes/proxy';
import mcp from './routes/mcp';

const app = new Hono<{ Bindings: Env }>();

// CORS only on the JSON API (the frontend's origin calls these). The MCP route
// sets its own CORS via createMcpHandler's corsOptions; applying cors() there too
// would emit a duplicate Access-Control-Allow-Origin that browsers reject.
app.use('/api/*', cors());

// Cap every request body at 1 MB, rejected before parsing (via Content-Length
// when present, so it's non-invasive to the MCP streaming handler). All write
// surfaces are unauthenticated — the JSON API reads the whole body via
// c.req.json(), and the MCP route is also reachable by anyone with the hash —
// so an uncapped body is a memory/CPU DoS. GET routes have no body (no-op).
app.use(
  '*',
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: 'Payload too large' }, 413),
  }),
);

app.route('/api/workspace/:wid/mcp-services', services);
app.route('/api/workspace/:wid/proxy', proxy);
app.route('/workspace', mcp);

app.get('/', (c) => c.text('MCP Workspace Backend'));

// Health check endpoint
app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

export default app;
