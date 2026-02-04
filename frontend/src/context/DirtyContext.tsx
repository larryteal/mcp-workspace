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
  /** Mark entire state as saved (sync server snapshot with current) */
  markAllSaved: (services: MCPService[]) => void;
  /** Reset server snapshot (e.g., after initial load from server) */
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

  const isOverviewDirty = useCallback((mcpId: string): boolean => {
    const current = currentServicesMap.get(mcpId);
    const saved = serverSnapshotMap.get(mcpId);

    // New service (not in server snapshot) is dirty
    if (current && !saved) return true;

    return !compareServiceOverview(current, saved);
  }, [currentServicesMap, serverSnapshotMap]);

  const isToolDirty = useCallback((mcpId: string, toolId: string): boolean => {
    const currentService = currentServicesMap.get(mcpId);
    const savedService = serverSnapshotMap.get(mcpId);

    const currentTool = currentService?.tools.find(t => t.id === toolId);
    const savedTool = savedService?.tools.find(t => t.id === toolId);

    // New tool (not in server snapshot) is dirty
    if (currentTool && !savedTool) return true;

    return !compareTools(currentTool, savedTool);
  }, [currentServicesMap, serverSnapshotMap]);

  const isServiceDirty = useCallback((mcpId: string): boolean => {
    const currentService = currentServicesMap.get(mcpId);
    const savedService = serverSnapshotMap.get(mcpId);

    // New service is dirty
    if (currentService && !savedService) return true;

    // Deleted service is dirty (this case is handled elsewhere)
    if (!currentService && savedService) return false;

    if (!currentService) return false;

    // Check overview
    if (isOverviewDirty(mcpId)) return true;

    // Check all tools
    for (const tool of currentService.tools) {
      if (isToolDirty(mcpId, tool.id)) return true;
    }

    // Check for deleted tools
    if (savedService) {
      for (const savedTool of savedService.tools) {
        const exists = currentService.tools.some(t => t.id === savedTool.id);
        if (!exists) return true; // Tool was deleted
      }
    }

    return false;
  }, [currentServicesMap, serverSnapshotMap, isOverviewDirty, isToolDirty]);

  const hasAnyDirty = useCallback((): boolean => {
    // Check for new or modified services
    for (const service of currentServices) {
      if (isServiceDirty(service.id)) return true;
    }

    // Check for deleted services
    for (const saved of serverSnapshot) {
      const exists = currentServices.some(s => s.id === saved.id);
      if (!exists) return true;
    }

    return false;
  }, [currentServices, serverSnapshot, isServiceDirty]);

  const getDirtyMcpIds = useCallback((): string[] => {
    const dirtyIds: string[] = [];

    for (const service of currentServices) {
      if (isServiceDirty(service.id)) {
        dirtyIds.push(service.id);
      }
    }

    return dirtyIds;
  }, [currentServices, isServiceDirty]);

  const getDirtyToolIds = useCallback((mcpId: string): string[] => {
    const service = currentServicesMap.get(mcpId);
    if (!service) return [];

    const dirtyIds: string[] = [];
    for (const tool of service.tools) {
      if (isToolDirty(mcpId, tool.id)) {
        dirtyIds.push(tool.id);
      }
    }

    return dirtyIds;
  }, [currentServicesMap, isToolDirty]);

  const markAllSaved = useCallback((services: MCPService[]) => {
    setServerSnapshotState(services);
  }, []);

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
        markAllSaved,
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
