import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import services from './routes/services';
import proxy from './routes/proxy';
import mcp from './routes/mcp';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.route('/api/workspace/:wid/mcp-services', services);
app.route('/api/workspace/:wid/proxy', proxy);
app.route('/workspace', mcp);

app.get('/', (c) => c.text('MCP Workspace Backend'));

// Health check endpoint
app.get('/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }));

export default app;
