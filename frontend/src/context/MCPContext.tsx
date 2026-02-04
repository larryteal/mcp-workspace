import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import type { MCPService, Tool } from '@/types';
import {
  storageService,
  saveAllToServer as saveAllToServerFn,
  fetchServicesFromServer,
} from '@/services/storage';
const generateUUID = () => crypto.randomUUID();
import { useWorkspace } from '@/context/WorkspaceContext';

const generateId = () => Math.random().toString(36).substring(2, 9);

interface MCPContextType {
  services: MCPService[];
  selectedMcpId: string | null;
  selectedToolId: string | null;
  isLoading: boolean;
  isSaving: boolean;
  isSyncing: boolean;
  /** Indicates if initial data has been loaded from server */
  dataLoaded: boolean;
  setSelectedMcpId: (id: string | null) => void;
  setSelectedToolId: (id: string | null) => void;
  toggleServiceExpanded: (id: string) => void;
  updateService: (id: string, updates: Partial<MCPService>) => void;
  updateTool: (mcpId: string, toolId: string, updates: Partial<Tool>) => void;
  addService: () => string;
  addTool: (mcpId: string) => string;
  deleteService: (id: string) => void;
  deleteTool: (mcpId: string, toolId: string) => void;
  getService: (id: string) => MCPService | undefined;
  getTool: (mcpId: string, toolId: string) => Tool | undefined;
  /** Save all services to server (full replace) */
  saveAllToServer: () => Promise<boolean>;
  /** Force fetch from server and overwrite local data */
  syncFromServer: () => Promise<void>;
  /** Validate a single MCP service for duplicate IDs */
  validateBeforeSave: (mcpId: string) => string | null;
  /** Validate all services for duplicate IDs */
  validateAllBeforeSave: () => string | null;
  /** Set callback to notify DirtyContext of state changes */
  setOnServicesChange: (callback: (services: MCPService[]) => void) => void;
  /** Set callback to notify DirtyContext of server snapshot */
  setOnServerSnapshotLoaded: (callback: (services: MCPService[]) => void) => void;
}

const MCPContext = createContext<MCPContextType | null>(null);

export function MCPProvider({ children }: { children: ReactNode }) {
  const { workspaceId } = useWorkspace();

  // Initialize with empty state - will be populated based on local-first strategy
  const [services, setServices] = useState<MCPService[]>([]);
  const [selectedMcpId, setSelectedMcpId] = useState<string | null>(null);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Track if we've already loaded for this workspace
  const loadedWorkspaceRef = useRef<string | null>(null);
  // Store server snapshot for late subscribers
  const serverSnapshotRef = useRef<MCPService[] | null>(null);
  // Use refs for callbacks to avoid async state timing issues
  const onServicesChangeRef = useRef<((services: MCPService[]) => void) | undefined>(undefined);
  const onServerSnapshotLoadedRef = useRef<((services: MCPService[]) => void) | undefined>(undefined);

  // Local-first data loading: check localStorage first, then server
  useEffect(() => {
    if (!workspaceId) {
      setIsLoading(false);
      setDataLoaded(true);
      return;
    }
    if (loadedWorkspaceRef.current === workspaceId) {
      setIsLoading(false);
      setDataLoaded(true);
      return;
    }

    // Check if local data exists for this workspace
    if (storageService.hasLocalData(workspaceId)) {
      // Load from localStorage, skip server fetch
      // storageService already ensures arrays, but double-check for safety
      const localServices = storageService.loadServices(workspaceId);
      const localSnapshot = storageService.loadServerSnapshot(workspaceId);
      const safeServices = Array.isArray(localServices) ? localServices : [];
      const safeSnapshot = Array.isArray(localSnapshot) ? localSnapshot : [];
      setServices(safeServices);
      serverSnapshotRef.current = safeSnapshot;
      onServerSnapshotLoadedRef.current?.(safeSnapshot);
      loadedWorkspaceRef.current = workspaceId;
      setIsLoading(false);
      setDataLoaded(true);
      return;
    }

    // No local data, fetch from server
    const abortController = new AbortController();
    let isCancelled = false;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const serverServices = await fetchServicesFromServer(workspaceId, abortController.signal);

        // Check if cancelled before updating state
        if (isCancelled) return;

        // fetchServicesFromServer already ensures array, but double-check for safety
        const safeServices = Array.isArray(serverServices) ? serverServices : [];
        setServices(safeServices);
        storageService.saveServices(workspaceId, safeServices);
        // Also save as server snapshot for dirty tracking
        storageService.saveServerSnapshot(workspaceId, safeServices);
        // Store server snapshot for late subscribers
        serverSnapshotRef.current = safeServices;
        // Notify DirtyContext of server snapshot (if callback is set)
        onServerSnapshotLoadedRef.current?.(safeServices);
        loadedWorkspaceRef.current = workspaceId;
        setIsLoading(false);
        setDataLoaded(true);
      } catch (error: unknown) {
        // Ignore abort errors (caused by React StrictMode or navigation)
        const isAbortError = isCancelled ||
          (error instanceof Error && (error.name === 'CanceledError' || error.name === 'AbortError')) ||
          (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ERR_CANCELED');

        if (isAbortError) return;

        console.error('Failed to fetch services from server:', error);
        // Use empty state as fallback, mark as server snapshot
        serverSnapshotRef.current = [];
        loadedWorkspaceRef.current = workspaceId;
        setIsLoading(false);
        setDataLoaded(true);
      }
    };

    fetchData();

    // Cleanup: abort fetch if component unmounts or workspace changes
    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [workspaceId]); // Intentionally exclude onServerSnapshotLoaded to avoid re-fetching

  // Save to localStorage whenever services change (only after initial load)
  useEffect(() => {
    if (!workspaceId || !dataLoaded) return;
    storageService.saveServices(workspaceId, services);
    // Notify DirtyContext of changes
    onServicesChangeRef.current?.(services);
  }, [services, workspaceId, dataLoaded]);

  const setOnServicesChange = useCallback((callback: (services: MCPService[]) => void) => {
    onServicesChangeRef.current = callback;
  }, []);

  const setOnServerSnapshotLoaded = useCallback((callback: (services: MCPService[]) => void) => {
    onServerSnapshotLoadedRef.current = callback;
    // If we already have server data, notify the callback immediately
    if (serverSnapshotRef.current) {
      callback(serverSnapshotRef.current);
    }
  }, []);

  const toggleServiceExpanded = useCallback((id: string) => {
    setServices(prev =>
      prev.map(s => (s.id === id ? { ...s, expanded: !s.expanded } : s))
    );
  }, []);

  const updateService = useCallback((id: string, updates: Partial<MCPService>) => {
    setServices(prev =>
      prev.map(s => (s.id === id ? { ...s, ...updates } : s))
    );
  }, []);

  const updateTool = useCallback((mcpId: string, toolId: string, updates: Partial<Tool>) => {
    setServices(prev =>
      prev.map(s =>
        s.id === mcpId
          ? {
              ...s,
              tools: s.tools.map(t =>
                t.id === toolId ? { ...t, ...updates } : t
              ),
            }
          : s
      )
    );
  }, []);

  const addService = useCallback(() => {
    const id = generateUUID();
    const newService: MCPService = {
      id,
      name: 'New MCP Service',
      version: '1.0.0',
      description: '',
      expanded: true,
      tools: [],
    };
    setServices(prev => [...prev, newService]);
    return id;
  }, [services]);

  const addTool = useCallback((mcpId: string) => {
    const id = generateUUID();
    const newTool: Tool = {
      id,
      name: 'newTool',
      description: '',
      method: 'GET',
      url: '',
      params: [{ id: generateId(), enabled: true, key: '', value: '', description: '' }],
      headers: [{ id: generateId(), enabled: true, key: '', value: '', description: '' }],
      cookies: [{ id: generateId(), enabled: true, key: '', value: '', description: '' }],
      bodyType: 'none',
      bodyContent: '',
      bodyFormData: [{ id: generateId(), enabled: true, key: '', value: '', description: '' }],
      bodyUrlEncoded: [{ id: generateId(), enabled: true, key: '', value: '', description: '' }],
      inputSchema: '',
      outputSchema: '',
    };
    setServices(prev =>
      prev.map(s =>
        s.id === mcpId
          ? { ...s, tools: [...s.tools, newTool], expanded: true }
          : s
      )
    );
    return id;
  }, [services]);

  const deleteService = useCallback((id: string) => {
    setServices(prev => prev.filter(s => s.id !== id));
    if (selectedMcpId === id) {
      setSelectedMcpId(null);
      setSelectedToolId(null);
    }
  }, [selectedMcpId]);

  const deleteTool = useCallback((mcpId: string, toolId: string) => {
    setServices(prev =>
      prev.map(s =>
        s.id === mcpId
          ? { ...s, tools: s.tools.filter(t => t.id !== toolId) }
          : s
      )
    );
    if (selectedToolId === toolId) {
      setSelectedToolId(null);
    }
  }, [selectedToolId]);

  const getService = useCallback((id: string) => {
    return services.find(s => s.id === id);
  }, [services]);

  const getTool = useCallback((mcpId: string, toolId: string) => {
    const service = services.find(s => s.id === mcpId);
    return service?.tools.find(t => t.id === toolId);
  }, [services]);

  const validateBeforeSave = useCallback((mcpId: string): string | null => {
    // Check duplicate MCP IDs
    const idCounts = services.filter(s => s.id === mcpId);
    if (idCounts.length > 1) {
      return `MCP ID '${mcpId}' already exists`;
    }

    // Check duplicate tool IDs within this MCP
    const service = services.find(s => s.id === mcpId);
    if (service) {
      const toolIds = new Set<string>();
      for (const tool of service.tools) {
        if (toolIds.has(tool.id)) {
          return `Tool ID '${tool.id}' already exists in this MCP`;
        }
        toolIds.add(tool.id);
      }
    }

    return null;
  }, [services]);

  const validateAllBeforeSave = useCallback((): string | null => {
    const mcpIds = new Set<string>();
    for (const service of services) {
      if (mcpIds.has(service.id)) {
        return `MCP ID '${service.id}' already exists`;
      }
      mcpIds.add(service.id);

      const toolIds = new Set<string>();
      for (const tool of service.tools) {
        if (toolIds.has(tool.id)) {
          return `Tool ID '${tool.id}' already exists in MCP '${service.name}'`;
        }
        toolIds.add(tool.id);
      }
    }
    return null;
  }, [services]);

  const saveAllToServer = useCallback(async (): Promise<boolean> => {
    const error = validateAllBeforeSave();
    if (error) {
      alert(error);
      return false;
    }

    setIsSaving(true);
    try {
      const success = await saveAllToServerFn(workspaceId, services);
      if (success) {
        // Update server snapshot after successful save
        serverSnapshotRef.current = services;
        storageService.saveServerSnapshot(workspaceId, services);
        onServerSnapshotLoadedRef.current?.(services);
      }
      return success;
    } finally {
      setIsSaving(false);
    }
  }, [services, validateAllBeforeSave, workspaceId]);

  const syncFromServer = useCallback(async (): Promise<void> => {
    if (!workspaceId) return;

    setIsSyncing(true);
    try {
      const serverServices = await fetchServicesFromServer(workspaceId);
      // fetchServicesFromServer already ensures array, but double-check for safety
      const safeServices = Array.isArray(serverServices) ? serverServices : [];
      setServices(safeServices);
      storageService.saveServices(workspaceId, safeServices);
      storageService.saveServerSnapshot(workspaceId, safeServices);
      serverSnapshotRef.current = safeServices;
      onServerSnapshotLoadedRef.current?.(safeServices);
    } catch (error) {
      console.error('Failed to sync from server:', error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [workspaceId]);

  return (
    <MCPContext.Provider
      value={{
        services,
        selectedMcpId,
        selectedToolId,
        isLoading,
        isSaving,
        isSyncing,
        dataLoaded,
        setSelectedMcpId,
        setSelectedToolId,
        toggleServiceExpanded,
        updateService,
        updateTool,
        addService,
        addTool,
        deleteService,
        deleteTool,
        getService,
        getTool,
        saveAllToServer,
        syncFromServer,
        validateBeforeSave,
        validateAllBeforeSave,
        setOnServicesChange,
        setOnServerSnapshotLoaded,
      }}
    >
      {children}
    </MCPContext.Provider>
  );
}

export function useMCP() {
  const context = useContext(MCPContext);
  if (!context) {
    throw new Error('useMCP must be used within a MCPProvider');
  }
  return context;
}
