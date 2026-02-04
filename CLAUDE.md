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
| PUT | `/api/workspace/:wid/mcp-services/batch` | Save all (full replace via UPSERT), body includes `widHash` |
| POST | `/api/workspace/:wid/proxy/test` | Proxy test request (accepts Tool directly) |
| ALL | `/workspace/:widHash/mcp/:serviceId` | MCP Streamable HTTP (JSON-RPC), uses MD5 hash |

**Data flow**: Frontend `MCPService[]` → JSON string → D1 `workspaces.data` → JSON parse → MCP tools

### MCP Streamable HTTP

The `/workspace/:widHash/mcp/:serviceId` endpoint implements MCP Streamable HTTP using McpServer from the MCP SDK and createMcpHandler from agents/mcp for Cloudflare Workers transport. Tools are registered dynamically from stored JSON, with JSON Schema converted to Zod schema for input validation.

Supported MCP methods:
- `initialize` — returns server info (name, version)
- `tools/list` — returns tools with inputSchema
- `tools/call` — substitutes `{{var}}` placeholders, executes HTTP request, returns result

### MCP URL Security

MCP URLs use MD5 hash of workspace ID instead of the raw UUID for security purposes.

**Purpose**: Prevent inferring the browser edit URL from the MCP URL. If someone sees an MCP URL, they cannot reverse-engineer the workspace UUID to access the management interface.

**URL formats**:
- Browser (edit) URL: `/workspace/{workspaceId}/mcp/{mcpId}/overview`
- MCP (service) URL: `/workspace/{MD5(workspaceId)}/mcp/{serviceId}`

**Implementation**:
- Frontend computes `MD5(workspaceId)` using pure JS implementation (`frontend/src/utils/md5.ts`)
- Frontend sends `widHash` to backend when saving workspace data
- Backend stores `wid_hash` in database and looks up by hash for MCP requests
- MCP endpoint queries `WHERE wid_hash = ?` instead of `WHERE id = ?`

### ID and Name Convention

- **Service/Tool `id`**: UUID generated via `crypto.randomUUID()`, used for URLs and database keys
- **Service/Tool `name`**: User-editable display name, used in MCP protocol (`tools/list` returns `name` as tool identifier)
- **MCP Config display name**: Derived from service `name` via slugify (lowercase, hyphen-separated)

### Template Variables

Tool configs can reference `{{varName}}` in url, params, headers, cookies, and body. At MCP `tools/call` time, these are substituted with values from the call's `arguments`. On save, variables should match `inputSchema.properties`.

### URL and Query Params Handling

The backend `httpExecutor` handles URLs that may already contain query params. URL can include query params directly, and Query Params config can also specify params separately. Config params override URL-embedded params with the same key. Invalid URLs throw a clear error message.

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