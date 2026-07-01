import axios from 'axios';
import type { MCPService, Tool, ProxyTestResponse } from '@/types';

const API_BASE = import.meta.env.VITE_MCP_API_BASE_URL ?? '';

/**
 * Normalize loaded data to the shape the UI assumes: drop non-object services,
 * and guarantee each service has a `tools` array of objects. The backend allows
 * a service with no `tools` field, and localStorage/server data may be legacy or
 * hand-edited — without this, `service.tools.map(...)` throws and white-screens
 * the app (and persists across reload via local-first).
 */
function normalizeServices(parsed: unknown): MCPService[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((s): s is MCPService => !!s && typeof s === 'object')
    .map((s) => ({
      ...s,
      tools: Array.isArray(s.tools)
        ? s.tools.filter((t) => !!t && typeof t === 'object').map(normalizeTool)
        : [],
    }));
}

/**
 * Coerce a tool's array fields to arrays. The backend treats `params`/`headers`/
 * `cookies`/`bodyFormData`/`bodyUrlEncoded` as optional, so a saved (or legacy/
 * API-created) tool may omit them — and `KeyValueTable` does `items.map(...)`,
 * which would throw and crash the editor (then re-crash on reload via local-first).
 */
function normalizeTool(t: Tool): Tool {
  return {
    ...t,
    params: Array.isArray(t.params) ? t.params : [],
    headers: Array.isArray(t.headers) ? t.headers : [],
    cookies: Array.isArray(t.cookies) ? t.cookies : [],
    bodyFormData: Array.isArray(t.bodyFormData) ? t.bodyFormData : [],
    bodyUrlEncoded: Array.isArray(t.bodyUrlEncoded) ? t.bodyUrlEncoded : [],
  };
}

/**
 * Get workspace-scoped storage keys
 */
function getStorageKeys(workspaceId: string) {
  return {
    SERVICES: `mcp-workspace:ws:${workspaceId}:services`,
    SNAPSHOT: `mcp-workspace:ws:${workspaceId}:snapshot`,
  };
}

/**
 * Storage service for persisting MCP configuration data.
 * All functions now require workspaceId for proper workspace isolation.
 */
export const storageService = {
  /**
   * Check if local data exists for this workspace
   */
  hasLocalData(workspaceId: string): boolean {
    const keys = getStorageKeys(workspaceId);
    return localStorage.getItem(keys.SERVICES) !== null;
  },

  loadServices(workspaceId: string): MCPService[] {
    try {
      const keys = getStorageKeys(workspaceId);
      const data = localStorage.getItem(keys.SERVICES);
      if (data) {
        return normalizeServices(JSON.parse(data));
      }
    } catch (error) {
      console.error('Failed to load services from storage:', error);
    }
    return [];
  },

  /** Returns true on success, false if the write failed (e.g. quota exceeded). */
  saveServices(workspaceId: string, services: MCPService[]): boolean {
    try {
      const keys = getStorageKeys(workspaceId);
      localStorage.setItem(keys.SERVICES, JSON.stringify(services));
      return true;
    } catch (error) {
      console.error('Failed to save services to storage:', error);
      return false;
    }
  },

  loadServerSnapshot(workspaceId: string): MCPService[] {
    try {
      const keys = getStorageKeys(workspaceId);
      const data = localStorage.getItem(keys.SNAPSHOT);
      if (data) {
        return normalizeServices(JSON.parse(data));
      }
    } catch (error) {
      console.error('Failed to load server snapshot:', error);
    }
    return [];
  },

  /** Returns true on success, false if the write failed (e.g. quota exceeded). */
  saveServerSnapshot(workspaceId: string, services: MCPService[]): boolean {
    try {
      const keys = getStorageKeys(workspaceId);
      localStorage.setItem(keys.SNAPSHOT, JSON.stringify(services));
      return true;
    } catch (error) {
      console.error('Failed to save server snapshot:', error);
      return false;
    }
  },

  clearWorkspaceData(workspaceId: string): void {
    const keys = getStorageKeys(workspaceId);
    localStorage.removeItem(keys.SERVICES);
    localStorage.removeItem(keys.SNAPSHOT);
  },
};

/**
 * Save all services to server (full replace).
 * Backend stores data in frontend format directly and computes wid_hash itself
 * from the workspace id, so the client does not send it.
 */
export async function saveAllToServer(workspaceId: string, services: MCPService[]): Promise<void> {
  try {
    await axios.put(`${API_BASE}/api/workspace/${workspaceId}/mcp-services/batch`, { services });
  } catch (error) {
    console.error('Failed to save all services:', error);
    // Surface the backend's specific reason (invalid schema, payload too large,
    // ...) instead of swallowing it, so the UI can tell the user why it failed.
    let message = 'Failed to save configurations.';
    const data = axios.isAxiosError(error) ? error.response?.data : undefined;
    if (data && typeof (data as { error?: unknown }).error === 'string') {
      message = (data as { error: string }).error;
    }
    throw new Error(message);
  }
}

/**
 * Fetch all services from server
 */
export async function fetchServicesFromServer(workspaceId: string, signal?: AbortSignal): Promise<MCPService[]> {
  const url = `${API_BASE}/api/workspace/${workspaceId}/mcp-services`;
  const res = await axios.get(url, { signal });
  // Normalize: always an array, every service has a tools[] of objects.
  return normalizeServices(res.data);
}

/**
 * Test tool via proxy - sends tool in frontend format directly
 */
export async function proxyTestTool(workspaceId: string, tool: Tool): Promise<ProxyTestResponse> {
  // Client-side timeout slightly above the backend's 30s upstream timeout, so a
  // stuck request can't leave the Test spinner spinning forever.
  const res = await axios.post(`${API_BASE}/api/workspace/${workspaceId}/proxy/test`, tool, {
    timeout: 35000,
  });
  return res.data;
}
