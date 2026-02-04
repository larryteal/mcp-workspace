-- Single table to store workspace data as JSON
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  wid_hash TEXT,
  data TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for MCP URL lookup by wid_hash
CREATE INDEX idx_workspaces_wid_hash ON workspaces(wid_hash);
