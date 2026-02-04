import axios from 'axios';
import type { MCPService, Tool, ProxyTestResponse } from '@/types';
import { md5 } from '@/utils/md5';

const API_BASE = import.meta.env.VITE_MCP_API_BASE_URL ?? '';

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
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      console.error('Failed to load services from storage:', error);
    }
    return [];
  },

  saveServices(workspaceId: string, services: MCPService[]): void {
    try {
      const keys = getStorageKeys(workspaceId);
      localStorage.setItem(keys.SERVICES, JSON.stringify(services));
    } catch (error) {
      console.error('Failed to save services to storage:', error);
    }
  },

  loadServerSnapshot(workspaceId: string): MCPService[] {
    try {
      const keys = getStorageKeys(workspaceId);
      const data = localStorage.getItem(keys.SNAPSHOT);
      if (data) {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      console.error('Failed to load server snapshot:', error);
    }
    return [];
  },

  saveServerSnapshot(workspaceId: string, services: MCPService[]): void {
    try {
      const keys = getStorageKeys(workspaceId);
      localStorage.setItem(keys.SNAPSHOT, JSON.stringify(services));
    } catch (error) {
      console.error('Failed to save server snapshot:', error);
    }
  },

  clearWorkspaceData(workspaceId: string): void {
    const keys = getStorageKeys(workspaceId);
    localStorage.removeItem(keys.SERVICES);
    localStorage.removeItem(keys.SNAPSHOT);
  },
};

/**
 * Save all services to server (full replace)
 * Backend stores data in frontend format directly - no transformation needed
 * widHash is MD5 of workspaceId, used for MCP URL security
 */
export async function saveAllToServer(workspaceId: string, services: MCPService[]): Promise<boolean> {
  try {
    const widHash = md5(workspaceId);
    await axios.put(`${API_BASE}/api/workspace/${workspaceId}/mcp-services/batch`, { services, widHash });
    return true;
  } catch (error) {
    console.error('Failed to save all services:', error);
    return false;
  }
}

/**
 * Fetch all services from server
 */
export async function fetchServicesFromServer(workspaceId: string, signal?: AbortSignal): Promise<MCPService[]> {
  const url = `${API_BASE}/api/workspace/${workspaceId}/mcp-services`;
  const res = await axios.get(url, { signal });
  // Ensure we always return an array (defensive check for unexpected server responses)
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Test tool via proxy - sends tool in frontend format directly
 */
export async function proxyTestTool(workspaceId: string, tool: Tool): Promise<ProxyTestResponse> {
  const res = await axios.post(`${API_BASE}/api/workspace/${workspaceId}/proxy/test`, tool);
  return res.data;
}
