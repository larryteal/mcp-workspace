import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import type { MCPService, Tool } from '@/types';

/**
 * Dirty state tracking for MCP services and tools.
 * Compares current state with server snapshot to detect unsaved changes.
 */

interface DirtyContextType {
  /** Check if a specific MCP service has unsaved changes (including any of its tools) */
  isServiceDirty: (mcpId: string) => boolean;
  /** Check if a specific tool has unsaved changes */
  isToolDirty: (mcpId: string, toolId: string) => boolean;
  /** Check if MCP overview (name, version, description) has unsaved changes */
  isOverviewDirty: (mcpId: string) => boolean;
  /** Check if any item is dirty */
  hasAnyDirty: () => boolean;
  /** Get all dirty MCP IDs */
  getDirtyMcpIds: () => string[];
  /** Get all dirty tool IDs for a specific MCP */
  getDirtyToolIds: (mcpId: string) => string[];
  /** Update the current services state for comparison */
  updateCurrentState: (services: MCPService[]) => void;
  /** Reset server snapshot (e.g., after initial load from server, or after save) */
  setServerSnapshot: (services: MCPService[]) => void;
}

const DirtyContext = createContext<DirtyContextType | null>(null);

/**
 * Deep compare two objects for equality
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
}

/**
 * Compare MCP service overview fields (excluding tools and expanded state)
 */
function compareServiceOverview(current: MCPService | undefined, saved: MCPService | undefined): boolean {
  if (!current && !saved) return true;
  if (!current || !saved) return false;

  return (
    current.name === saved.name &&
    current.version === saved.version &&
    current.description === saved.description
  );
}

/**
 * Compare two tools for equality (excluding transient properties)
 */
function compareTools(current: Tool | undefined, saved: Tool | undefined): boolean {
  if (!current && !saved) return true;
  if (!current || !saved) return false;

  return (
    current.name === saved.name &&
    current.description === saved.description &&
    current.method === saved.method &&
    current.url === saved.url &&
    current.bodyType === saved.bodyType &&
    current.bodyContent === saved.bodyContent &&
    deepEqual(current.params, saved.params) &&
    deepEqual(current.headers, saved.headers) &&
    deepEqual(current.cookies, saved.cookies) &&
    deepEqual(current.bodyFormData, saved.bodyFormData) &&
    deepEqual(current.bodyUrlEncoded, saved.bodyUrlEncoded) &&
    current.inputSchema === saved.inputSchema &&
    current.outputSchema === saved.outputSchema
  );
}

export function DirtyProvider({ children }: { children: ReactNode }) {
  // Current state of services
  const [currentServices, setCurrentServices] = useState<MCPService[]>([]);
  // Server snapshot - the last known saved state (initialized empty, will be set via callback from MCPContext)
  const [serverSnapshot, setServerSnapshotState] = useState<MCPService[]>([]);

  // Create lookup maps for efficient comparison
  const serverSnapshotMap = useMemo(() => {
    const map = new Map<string, MCPService>();
    serverSnapshot.forEach(service => map.set(service.id, service));
    return map;
  }, [serverSnapshot]);

  const currentServicesMap = useMemo(() => {
    const map = new Map<string, MCPService>();
    currentServices.forEach(service => map.set(service.id, service));
    return map;
  }, [currentServices]);

  const updateCurrentState = useCallback((services: MCPService[]) => {
    setCurrentServices(services);
  }, []);

  const setServerSnapshot = useCallback((services: MCPService[]) => {
    setServerSnapshotState(services);
  }, []);

  // Compute all dirty results in ONE pass per (current, snapshot) change, reusing
  // the exact same compareServiceOverview/compareTools/deepEqual as before. This
  // replaces the previous approach where every consumer re-walked the whole tree
  // (O(consumers × services × tools) deep-compares) on every render/keystroke;
  // the getters below are now O(1)/O(list) lookups over these precomputed tables.
  const dirty = useMemo(() => {
    // Current mcpIds whose overview (name/version/description) differs, or is new.
    const overviewDirty = new Set<string>();
    // mcpId -> (toolId -> isDirty) for every CURRENT tool (O(1) lookup + list building).
    const toolResult = new Map<string, Map<string, boolean>>();
    // Current mcpIds where isServiceDirty(...) is true.
    const serviceDirty = new Set<string>();
    // Any snapshot service absent from current (drives hasAnyDirty, not isServiceDirty).
    let hasDeletedService = false;

    // Iterate unique current services via the map (last-wins on duplicate ids),
    // matching how the old code resolved mcpId through currentServicesMap.get.
    for (const [mcpId, current] of currentServicesMap) {
      const saved = serverSnapshotMap.get(mcpId);

      // Overview: new service (no saved) → dirty; else compare the three fields.
      const ovDirty = !saved ? true : !compareServiceOverview(current, saved);
      if (ovDirty) overviewDirty.add(mcpId);

      // First-wins saved-tool lookup, matching `saved.tools.find(t => t.id === id)`.
      const savedToolById = new Map<string, Tool>();
      if (saved) {
        for (const st of saved.tools) if (!savedToolById.has(st.id)) savedToolById.set(st.id, st);
      }

      // Per current tool, reproduce isToolDirty: new tool (no saved) → dirty;
      // else !compareTools. First-wins on duplicate current ids, matching `.find`.
      const toolMap = new Map<string, boolean>();
      for (const tool of current.tools) {
        if (toolMap.has(tool.id)) continue; // first-wins mirror of .find
        const savedTool = savedToolById.get(tool.id);
        toolMap.set(tool.id, !savedTool ? true : !compareTools(tool, savedTool));
      }
      toolResult.set(mcpId, toolMap);

      // Service dirty = new || overview dirty || any tool dirty || any deleted tool.
      const anyToolDirty = [...toolMap.values()].some(Boolean);
      let svcDirty = !saved || ovDirty || anyToolDirty;
      if (!svcDirty && saved) {
        const currentToolIds = new Set(current.tools.map(t => t.id));
        for (const st of saved.tools) {
          if (!currentToolIds.has(st.id)) { svcDirty = true; break; } // tool deleted
        }
      }
      if (svcDirty) serviceDirty.add(mcpId);
    }

    // Deleted services (in snapshot, not in current).
    for (const savedId of serverSnapshotMap.keys()) {
      if (!currentServicesMap.has(savedId)) { hasDeletedService = true; break; }
    }

    return { overviewDirty, toolResult, serviceDirty, hasDeletedService };
  }, [currentServicesMap, serverSnapshotMap]);

  const isOverviewDirty = useCallback((mcpId: string): boolean => {
    if (currentServicesMap.has(mcpId)) return dirty.overviewDirty.has(mcpId);
    // Not in current: old code returns !compareServiceOverview(undefined, saved),
    // i.e. true iff a saved service exists (unreachable via UI; kept for parity).
    return serverSnapshotMap.has(mcpId);
  }, [dirty, currentServicesMap, serverSnapshotMap]);

  const isToolDirty = useCallback((mcpId: string, toolId: string): boolean => {
    const toolMap = dirty.toolResult.get(mcpId);
    if (toolMap && toolMap.has(toolId)) return toolMap.get(toolId)!; // current tool → O(1)
    // Not a current tool: old code returns !compareTools(undefined, savedTool),
    // i.e. true iff a saved tool exists (unreachable via UI; kept for parity).
    const savedTool = serverSnapshotMap.get(mcpId)?.tools.find(t => t.id === toolId);
    return !compareTools(undefined, savedTool);
  }, [dirty, serverSnapshotMap]);

  const isServiceDirty = useCallback((mcpId: string): boolean => {
    if (currentServicesMap.has(mcpId)) return dirty.serviceDirty.has(mcpId);
    // Not in current: old code returns false (deleted service is counted only by
    // hasAnyDirty, and absent-in-both is false).
    return false;
  }, [dirty, currentServicesMap]);

  const hasAnyDirty = useCallback((): boolean => {
    return dirty.serviceDirty.size > 0 || dirty.hasDeletedService;
  }, [dirty]);

  const getDirtyMcpIds = useCallback((): string[] => {
    // Iterate the currentServices array (order + duplicate-id repeats preserved,
    // matching the old code).
    const dirtyIds: string[] = [];
    for (const service of currentServices) {
      if (dirty.serviceDirty.has(service.id)) dirtyIds.push(service.id);
    }
    return dirtyIds;
  }, [dirty, currentServices]);

  const getDirtyToolIds = useCallback((mcpId: string): string[] => {
    const service = currentServicesMap.get(mcpId);
    if (!service) return [];
    const toolMap = dirty.toolResult.get(mcpId);
    if (!toolMap) return [];
    const dirtyIds: string[] = [];
    for (const tool of service.tools) {
      if (toolMap.get(tool.id)) dirtyIds.push(tool.id);
    }
    return dirtyIds;
  }, [dirty, currentServicesMap]);

  return (
    <DirtyContext.Provider
      value={{
        isServiceDirty,
        isToolDirty,
        isOverviewDirty,
        hasAnyDirty,
        getDirtyMcpIds,
        getDirtyToolIds,
        updateCurrentState,
        setServerSnapshot,
      }}
    >
      {children}
    </DirtyContext.Provider>
  );
}

export function useDirty() {
  const context = useContext(DirtyContext);
  if (!context) {
    throw new Error('useDirty must be used within a DirtyProvider');
  }
  return context;
}
