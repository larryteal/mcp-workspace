# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP Workspace is a visual configuration platform that converts existing REST APIs into standardized Remote MCP services. It serves as a conversion bridge - the backend runs a generic, highly abstract MCP service that dynamically maps user-configured API rules to MCP-compliant Tools.

## Technology Stack

**Frontend**:
- React 19.x (Concurrent rendering)
- Ant Design 6.x (dark mode support)
- Vite (build tool)
- TypeScript (strict type checking)
- Axios (HTTP requests, API verification)
- pnpm (package manager)

**Backend**:
- Hono (lightweight web framework)
- Cloudflare Workers (runtime)
- D1 / SQLite (persistence — single `workspaces` table storing JSON)
- `@modelcontextprotocol/sdk` McpServer + `agents/mcp` createMcpHandler (MCP Streamable HTTP transport)
- Zod 4.x with `z.fromJSONSchema()` for JSON Schema → Zod conversion

## Development Commands

```bash
# Frontend
cd frontend && pnpm install && pnpm dev        # Start frontend dev server (port 5173)
cd frontend && pnpm build                       # Build frontend

# Backend
cd backend && pnpm install                      # Install backend deps
cd backend && npx wrangler d1 migrations apply DB --local  # Run D1 migrations
cd backend && pnpm dev                          # Start backend (wrangler dev, port 2300)
```

## Project Structure

- `design/` - UI design specifications (.pen files, access via Pencil MCP tools only)
- `frontend/` - Management platform frontend code (1:1 correspondence with design)
- `backend/` - Hono on Cloudflare Workers — CRUD API, proxy test, MCP server
  - `backend/migrations/` - D1 SQL migration files
  - `backend/src/routes/` - API route handlers (services.ts, proxy.ts, mcp.ts)
  - `backend/src/utils/` - Template variable substitution, HTTP executor

## Backend Architecture

### Database Design

Single `workspaces` table storing workspace data as JSON. Each workspace has:
- `id` (UUID) — workspace identifier, used in browser URLs
- `wid_hash` (MD5) — MD5 hash of workspace ID, used in MCP URLs for security
- `data` (JSON) — array of MCPService objects
- `updated_at` (timestamp)

**Design principles**:
- Frontend format stored directly — no data transformation needed
- Full replace on save (UPSERT) — simple and atomic
- No foreign keys, no complex joins

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/workspace/:wid/mcp-services` | Fetch workspace data (returns MCPService[]) |
| PUT | `/api/workspace/:wid/mcp-services/batch` | Save all (full replace via UPSERT); backend validates payload and computes `wid_hash` itself |
| POST | `/api/workspace/:wid/proxy/test` | Proxy test request (accepts Tool directly) |
| ALL | `/workspace/:widHash/mcp/:serviceId` | MCP Streamable HTTP (JSON-RPC), uses MD5 hash |

**Data flow**: Frontend `MCPService[]` → JSON string → D1 `workspaces.data` → JSON parse → MCP tools

### MCP Streamable HTTP

The `/workspace/:widHash/mcp/:serviceId` endpoint implements MCP Streamable HTTP using McpServer from the MCP SDK and createMcpHandler from agents/mcp for Cloudflare Workers transport. Tools are registered dynamically from stored JSON.

**Schema handling** (`utils/schema.ts` `compileSchema` — single source of truth for both save-time validation and runtime registration): inputSchema/outputSchema are optional; when present they must be a valid JSON object with top-level `type: "object"` that `z.fromJSONSchema()` can convert. Invalid (non-empty) schemas are rejected on save (400) and skip the offending tool at runtime (fail-closed). Each tool registers in its own try/catch, so a bad/duplicate tool never 500s the whole service.

Supported MCP methods:
- `initialize` — returns server info (name, version)
- `tools/list` — returns tools with inputSchema (and outputSchema when declared)
- `tools/call` — substitutes `{{var}}` placeholders, executes the HTTP request, maps the response (below)

**`tools/call` response mapping**:
- Upstream 4xx/5xx → `isError: true` with the upstream body as content
- Text returned verbatim; binary read losslessly and mapped by Content-Type: `image/*` → image, `audio/*` → audio, other binary → embedded resource (base64 blob); `image/svg+xml` is treated as text. Bodies are stream-read with a 10 MB cap (oversized → error).
- When a tool declares an outputSchema and the upstream returns a JSON object, `structuredContent` is included and the SDK strictly validates it (binary output is incompatible with outputSchema)
- Transport/execution failures return a generic `isError` ("Upstream request failed."); details are logged, not exposed to the LLM
- A non-existent service returns a JSON-RPC top-level error (code -32602) over HTTP 200

### MCP URL Security

MCP URLs use MD5 hash of workspace ID instead of the raw UUID for security purposes.

**Purpose**: Prevent inferring the browser edit URL from the MCP URL. If someone sees an MCP URL, they cannot reverse-engineer the workspace UUID to access the management interface.

**URL formats**:
- Browser (edit) URL: `/workspace/{workspaceId}/mcp/{mcpId}/overview`
- MCP (service) URL: `/workspace/{MD5(workspaceId)}/mcp/{serviceId}`

**Implementation**:
- Frontend computes `MD5(workspaceId)` (`frontend/src/utils/md5.ts`) only to display the MCP URL
- Backend computes `wid_hash = MD5(workspaceId)` server-side on save and never trusts a client-supplied hash, using a byte-identical MD5 implementation (`backend/src/utils/md5.ts`)
- Backend stores `wid_hash` in database and looks up by hash for MCP requests
- MCP endpoint queries `WHERE wid_hash = ?` instead of `WHERE id = ?`

### ID and Name Convention

- **Service/Tool `id`**: UUID generated via `crypto.randomUUID()`, used for URLs and database keys
- **Service/Tool `name`**: User-editable display name, used in MCP protocol (`tools/list` returns `name` as tool identifier)
- **MCP Config display name**: Derived from service `name` via slugify (lowercase, hyphen-separated)

### Field Validation (save-time)

On save (`PUT .../batch`) the backend validates every field; the frontend mirrors the same rules (`backend/src/utils/validate.ts` ⇄ `frontend/src/utils/validate.ts` — keep them in sync) for live feedback and a pre-save check in `validateAllBeforeSave`. The backend is authoritative. Classes:

- **URL** (tool `url`): non-empty, ≤256 chars, must be an `http(s)` URL. `{{var}}` placeholders are allowed in the path/host/query (substituted with a benign token before parsing), but the scheme+host must be literal — a fully-templated authority like `{{base}}/x` is rejected (URL values are percent-encoded at call time, so a var can't form the authority).
- **Name** (service `name`, tool `name`): non-empty, ≤32 chars, only `[A-Za-z0-9_]` (MCP identifier charset). New-service default name is `NewMCPService` so the default itself is valid.
- **KV key** (header/param/cookie names): non-empty, ≤64 chars, `[A-Za-z0-9_.-]` (HTTP-friendly — allows hyphens/dots, e.g. `Content-Type`). KV rows with an empty key are placeholder rows ignored at runtime, so their key is not required.
- **Text** (service `version`/`description`, tool `description`, KV `value`/`description`): optional, ≤2048 chars, any characters.
- **Schema/body** (tool `inputSchema`/`outputSchema`/`bodyContent`): optional, ≤4096 chars (`SCHEMA_MAX` — larger than plain text since non-trivial JSON Schemas/bodies exceed 2048). `inputSchema`/`outputSchema` are additionally validated as JSON Schema (see below).
- **Enum**: tool `method` ∈ {GET, POST, PUT, DELETE, PATCH} (required); tool `bodyType` ∈ {none, raw-json, form-data, x-www-form-urlencoded, binary} (optional, empty → none). Rejects crafted/unknown values.

Limits live in `LIMITS` (`URL_MAX`/`NAME_MAX`/`TEXT_MAX`/`KEY_MAX`); inputs also set `maxLength` for these. Service-id and tool-name (within a service) uniqueness are enforced here too. The frontend's shared `validateTool()` runs the non-schema checks both at save and before the **Test** action; the `POST .../proxy/test` endpoint independently re-validates url/method/bodyType server-side (it executes a request, so a direct call must not bypass validation).

### Template Variables

Tool configs can reference `{{varName}}` in url, params, headers, cookies, and body. At MCP `tools/call` time, these are substituted with values from the call's `arguments`. On save, variables should match `inputSchema.properties`. The placeholder name is any run of non-brace characters (whitespace trimmed), so names that aren't bare `\w` are supported — e.g. `{{user-id}}`, `{{user.id}}`, `{{ name }}`.

**Injection-safe substitution**: values substituted into the **URL** are percent-encoded (`encodeURIComponent`) and values substituted into **cookies** are cookie-safe-encoded (strip CR/LF, encode `;`/`,` only — base64/JWT chars `+` `/` `=` are preserved) so an untrusted caller arg can't inject extra query params / path segments or smuggle a second cookie. (Config `params` are encoded by `URLSearchParams.set`; header values are CRLF-rejected by the runtime `Headers`.) Consequence: a URL's scheme+host must be literal — a value used as the whole authority would be percent-encoded. Note: raw-json **body** substitution is not JSON-escaped, so a tool exposing `{{var}}` inside a JSON string still trusts the caller's value there.

### URL and Query Params Handling

The backend `httpExecutor` handles URLs that may already contain query params. URL can include query params directly, and Query Params config can also specify params separately. Config params override URL-embedded params with the same key. Invalid URLs throw a clear error message.

**Body / Content-Type**: GET/HEAD requests never send a body (fetch rejects one) — any configured body is dropped for those methods. For `raw-json` and `x-www-form-urlencoded`, the default Content-Type is only applied when the tool config hasn't set its own Content-Type header (an explicit header is preserved).

**Timeout / redirects**: upstream `fetch` is bound by a 30s `AbortSignal.timeout` (slow/hanging upstream aborts → generic error). Redirects are forbidden (`redirect: 'error'`) — a 3xx response throws — so the internal-host guard (initial URL only) can't be bypassed by an external URL redirecting to an internal host.

**DoS limits**: per-request CPU is capped at 100ms (`limits.cpu_ms` in `wrangler.jsonc`, repeated per env) — backstops CPU exhaustion such as a catastrophic-backtracking `pattern` in a user-supplied JSON Schema (the SDK runs `inputSchema`/`outputSchema` regexes against `tools/call` args). The JSON API (`/api/*` — workspace save + `proxy/test`) has a 1MB request-body cap (`hono/body-limit`, rejected pre-parse). Save payload is additionally capped at 1MB post-parse; response bodies stream with a 10MB cap.

**Internal-host guard**: Outside local dev, requests to internal targets are rejected (`isInternalHost`): localhost/`*.localhost`, IPv4 loopback/private/link-local (`0/8`, `127/8`, `10/8`, `172.16-31`, `192.168/16`, `169.254/16` incl. metadata, `100.64/10`), IPv6 `::1`/`::`/`fe80::/10`/`fc00::/7`, and IPv4-mapped IPv6 forms of those. Gated by `allowInternalHosts`, derived from `isDevEnvironment(env)` (`env.ENVIRONMENT === 'development'`). The deployed default is **safe**: top-level `vars.ENVIRONMENT = "production"` in `wrangler.jsonc`, so a bare `wrangler deploy` (no `--env`) denies internal hosts. Local dev re-enables localhost via `backend/.dev.vars` (`ENVIRONMENT=development`), which **only `wrangler dev` loads and is never deployed** (gitignored — each dev creates their own; without it, `wrangler dev` runs as production, the safe failure mode). `--env staging`/`--env production` set their own `ENVIRONMENT`. Redirects are forbidden (see above), so they can't bypass the guard. **Residual limitation**: only the literal hostname is checked, so a DNS name that resolves to an internal IP is not caught (no resolution is performed).

### MCP Client Headers

MCP clients (e.g., Claude Desktop) can configure custom headers in their MCP server config with `serverUrl` and `headers` properties. These headers are included in every MCP protocol request (initialize, tools/list, tools/call) and forwarded to upstream APIs during tool calls.

**Header flow**: MCP client sends headers → Hono handler extracts headers (excluding protocol headers) → merged with tool config headers (client headers take priority) → forwarded to upstream API.

**Excluded headers**: Protocol/transport headers are not forwarded (host, content-type, accept, mcp-session-id, mcp-protocol-version, cf-* headers, x-forwarded-*, etc.)

## Frontend Architecture

### Directory Structure

```
frontend/src/
├── main.tsx                 # Entry point
├── App.tsx                  # Root component, routing, state sync
├── styles/
│   ├── variables.css        # CSS design tokens
│   └── global.css           # Global styles, fonts
├── types/
│   └── index.ts             # TypeScript interfaces (MCPService, Tool, etc.)
├── services/
│   └── storage.ts           # API calls (axios), workspace-scoped localStorage
├── context/
│   ├── MCPContext.tsx       # MCP services state management
│   ├── TabContext.tsx       # Tab state management
│   ├── WorkspaceContext.tsx # Workspace ID management
│   └── DirtyContext.tsx     # Dirty state tracking for unsaved changes
├── hooks/
│   └── useApiTest.ts        # API testing hook
├── utils/
│   ├── api.ts               # Axios instance, proxy test helper
│   └── md5.ts               # MD5 hash implementation for MCP URL security
├── components/
│   ├── layout/              # Layout components (Sidebar, MCPTree, TabBar)
│   ├── common/              # Reusable UI components
│   ├── mcp/                 # MCP Overview components
│   └── tool/                # Tool Config components
└── pages/
    ├── MCPOverviewPage.tsx  # MCP Overview page
    └── ToolConfigPage.tsx   # Tool Config page
```

### State Management

**MCPContext** (`context/MCPContext.tsx`):
- Manages MCP services list and CRUD operations
- Implements **local-first loading strategy**: checks workspace-scoped localStorage first, then fetches from server if no local data exists
- Tracks selected MCP and Tool IDs
- Provides `services`, `saveAllToServer()`, `syncFromServer()`, and CRUD operations
- Uses refs for callbacks to avoid async state timing issues with DirtyContext

**DirtyContext** (`context/DirtyContext.tsx`):
- Tracks unsaved changes by comparing current state to server snapshot
- Server snapshot is set via callback from MCPContext (not loaded from localStorage directly)
- Provides dirty state checks: `isServiceDirty()`, `isToolDirty()`, `isOverviewDirty()`, `hasAnyDirty()`

**WorkspaceContext** (`context/WorkspaceContext.tsx`):
- Generates and persists a unique workspace ID in localStorage
- Workspace ID is used to scope all localStorage keys

**TabContext** (`context/TabContext.tsx`):
- Manages open tabs and active tab state
- Syncs with URL navigation

**DirtyStateSync** (in `App.tsx`):
- Bridge component that connects MCPContext and DirtyContext
- Registers callbacks to sync services changes and server snapshots

### Data Persistence Strategy

**Workspace-scoped localStorage keys**:
- `mcp-workspace:ws:{workspaceId}:services` — current services state
- `mcp-workspace:ws:{workspaceId}:snapshot` — last known server state (for dirty tracking)

**Local-first loading**:
1. On page load, check if localStorage has data for this workspace
2. If YES: load from localStorage, skip server fetch (preserves local edits)
3. If NO: fetch from server, save to both localStorage keys

**Sync from Server**: User can manually trigger `syncFromServer()` to overwrite local data with server data (shows confirmation if there are unsaved changes)

### Key Data Types

**MCPService**: Represents an MCP service with `id` (UUID), `name`, `version`, `description`, `expanded` (UI state), and `tools` array.

**Tool**: Represents an API tool with `id` (UUID), `name`, `description`, HTTP config (`method`, `url`, `params`, `headers`, `cookies`, `bodyType`, `bodyContent`, etc.), and schema definitions (`inputSchema`, `outputSchema` as JSON strings).

**KeyValueItem**: Used for params, headers, cookies with `id`, `enabled`, `key`, `value`, `description` fields.

### Implementation Notes

- All screens share the same Sidebar + Main Content layout structure
- Tab bar supports multiple open tabs (Overview tab + Tool tabs)
- Sidebar has three action buttons: Sync (refresh from server), Save All, Add MCP Service
- "Test" button in Tool Config triggers API verification via backend proxy
- Backend stores frontend data format directly — no transformation layer needed

### Known Limitations

- **Binary upload**: Disabled in frontend
- **Form-data body**: Disabled in frontend, not supported in backend
- **Response cookies**: Read from server but browser may handle separately

## Design System

### Design Tokens

CSS variables defined in `frontend/src/styles/variables.css`:

**Colors (Dark Theme)**: Primary accent (#1677ff), background (#141414), surface (#1f1f1f), surface-inset (#141414), border (#424242)

**Text Colors**: Primary (85% white), secondary (65% white), tertiary (45% white), muted (25% white)

**Semantic Colors**: Success (#52c41a), warning (#faad14), error (#ff4d4f)

**Typography**: Sans-serif (Inter), monospace (JetBrains Mono)

## Working with Design Files

Design files (`.pen`) are encrypted and must be accessed via Pencil MCP tools only:
- `batch_get` - Read node structure
- `batch_design` - Modify design
- `get_screenshot` - Visual verification
- `get_variables` - Read design tokens

Do NOT use `Read` or `Grep` tools on `.pen` files.

## pnpm
Use pnpm instead of npm.