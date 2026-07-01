import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import type { MCPService, Tool } from '@/types';
import {
  storageService,
  saveAllToServer as saveAllToServerFn,
  fetchServicesFromServer,
} from '@/services/storage';
const generateUUID = () => crypto.randomUUID();
import { useWorkspace } from '@/context/WorkspaceContext';
import { alertDialog } from '@/components/common';
import { validateSchemaString } from '@/utils/schema';
import { validateName, validateText, validateTool, LIMITS } from '@/utils/validate';

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
  // Warn at most once when local persistence fails (e.g. quota/private mode).
  const localWriteWarnedRef = useRef(false);
  // True when the initial server load failed. While set, we must NOT persist the
  // (empty) in-memory state to localStorage — doing so would make hasLocalData()
  // true and cause the next reload to skip the server fetch, masking the real
  // server data (and letting Save All overwrite it). Cleared on any successful load/sync.
  const loadFailedRef = useRef(false);

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

    // Switching to a different, not-yet-loaded workspace: clear the previous
    // workspace's in-memory data so it can't be persisted under the new key
    // (see the persistence effect's guard) or shown while the new one loads.
    if (loadedWorkspaceRef.current !== null) {
      setServices([]);
      setDataLoaded(false);
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
      loadFailedRef.current = false;
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
        loadFailedRef.current = false;
        setIsLoading(false);
        setDataLoaded(true);
      } catch (error: unknown) {
        // Ignore abort errors (caused by React StrictMode or navigation)
        const isAbortError = isCancelled ||
          (error instanceof Error && (error.name === 'CanceledError' || error.name === 'AbortError')) ||
          (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ERR_CANCELED');

        if (isAbortError) return;

        console.error('Failed to fetch services from server:', error);
        // Load FAILED — show empty but mark it so we never persist this empty
        // state (which would poison local-first and mask/overwrite server data).
        // loadedWorkspaceRef is still set so syncFromServer can retry in place.
        serverSnapshotRef.current = [];
        loadedWorkspaceRef.current = workspaceId;
        loadFailedRef.current = true;
        setIsLoading(false);
        setDataLoaded(true);
        if (!isCancelled) {
          void alertDialog({
            title: 'Failed to load from server',
            message:
              'Could not load this workspace from the server. Your saved data is safe on the server — it is NOT shown here. Use "Sync" to retry before making changes; saving now could overwrite the server copy.',
          });
        }
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
    // Only persist for the workspace that actually finished loading — guards the
    // brief window during a workspace switch where `services` still holds the
    // previous workspace's data (otherwise it would be written under the new key).
    if (loadedWorkspaceRef.current !== workspaceId) return;
    // Never persist while the initial load is in a failed state — see loadFailedRef.
    if (loadFailedRef.current) return;
    const ok = storageService.saveServices(workspaceId, services);
    if (!ok && !localWriteWarnedRef.current) {
      // Don't silently drop the local copy: tell the user once that local
      // persistence failed so they know to Save to the server (a refresh would
      // otherwise re-fetch the server copy and lose unsaved edits).
      localWriteWarnedRef.current = true;
      void alertDialog({
        title: 'Local save failed',
        message:
          'Could not save changes to local storage (it may be full or disabled). Your edits are kept in memory for now — use "Save All" to persist them to the server before reloading.',
      });
    }
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
      // Default must satisfy the name rule (letters/digits/underscore, ≤32).
      name: 'NewMCPService',
      version: '1.0.0',
      description: '',
      expanded: true,
      tools: [],
    };
    setServices(prev => [...prev, newService]);
    return id;
  }, []);

  const addTool = useCallback((mcpId: string) => {
    const id = generateUUID();
    const newTool: Tool = {
      id,
      name: 'newTool',
      description: '',
      method: 'GET',
      url: '',
      params: [{ id: generateUUID(), enabled: true, key: '', value: '', description: '' }],
      headers: [{ id: generateUUID(), enabled: true, key: '', value: '', description: '' }],
      cookies: [{ id: generateUUID(), enabled: true, key: '', value: '', description: '' }],
      bodyType: 'none',
      bodyContent: '',
      bodyFormData: [{ id: generateUUID(), enabled: true, key: '', value: '', description: '' }],
      bodyUrlEncoded: [{ id: generateUUID(), enabled: true, key: '', value: '', description: '' }],
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
  }, []);

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

      const svcLabel = service.name || service.id;

      // Service-level field rules (mirror backend utils/validate.ts).
      const svcNameErr = validateName(service.name, `MCP '${svcLabel}' name`);
      if (svcNameErr) return svcNameErr;
      const svcVersionErr = validateText(service.version, `MCP '${svcLabel}' version`);
      if (svcVersionErr) return svcVersionErr;
      const svcDescErr = validateText(service.description, `MCP '${svcLabel}' description`);
      if (svcDescErr) return svcDescErr;

      const toolIds = new Set<string>();
      const toolNameKeys = new Set<string>();
      for (const tool of service.tools) {
        if (toolIds.has(tool.id)) {
          return `Tool ID '${tool.id}' already exists in MCP '${svcLabel}'`;
        }
        toolIds.add(tool.id);

        const toolLabel = tool.name || tool.id;
        const prefix = `Tool '${toolLabel}' in MCP '${svcLabel}'`;

        // Tool field rules (name, url, method, bodyType, text, KV) — shared with the Test action.
        const toolErr = validateTool(tool, prefix);
        if (toolErr) return toolErr;

        // MCP identifies tools by name; the runtime dedups on (name || id) and
        // silently drops repeats, so reject duplicates here with a clear message.
        const nameKey = tool.name || tool.id;
        if (toolNameKeys.has(nameKey)) {
          return `Tool name '${tool.name}' is duplicated in MCP '${svcLabel}' (tool names must be unique)`;
        }
        toolNameKeys.add(nameKey);

        // Length (text class) then JSON-Schema validity — matches the backend,
        // which length-checks schemas before the Zod conversion.
        const inputLenErr = validateText(tool.inputSchema, `${prefix}: Input Schema`, LIMITS.SCHEMA_MAX);
        if (inputLenErr) return inputLenErr;
        const inputErr = validateSchemaString(tool.inputSchema ?? '');
        if (inputErr) {
          return `${prefix}: Input Schema — ${inputErr}`;
        }
        const outputLenErr = validateText(tool.outputSchema, `${prefix}: Output Schema`, LIMITS.SCHEMA_MAX);
        if (outputLenErr) return outputLenErr;
        const outputErr = validateSchemaString(tool.outputSchema ?? '');
        if (outputErr) {
          return `${prefix}: Output Schema — ${outputErr}`;
        }
      }
    }
    return null;
  }, [services]);

  const saveAllToServer = useCallback(async (): Promise<boolean> => {
    // Hard gate: if the initial server load failed, the in-memory state is NOT
    // authoritative (server data was never loaded). Saving now would full-replace
    // and destroy the server copy — require a successful Sync first.
    if (loadFailedRef.current) {
      await alertDialog({
        title: 'Cannot save yet',
        message:
          'This workspace failed to load from the server, so what you see may be incomplete. Click "Sync" to load the latest server data before saving — saving now could overwrite it.',
      });
      return false;
    }

    const error = validateAllBeforeSave();
    if (error) {
      await alertDialog({ title: 'Validation Error', message: error });
      return false;
    }

    setIsSaving(true);
    try {
      // Throws on failure (with the backend's reason); reaching here means saved.
      await saveAllToServerFn(workspaceId, services);
      // Update server snapshot after successful save
      serverSnapshotRef.current = services;
      storageService.saveServerSnapshot(workspaceId, services);
      onServerSnapshotLoadedRef.current?.(services);
      return true;
    } finally {
      setIsSaving(false);
    }
  }, [services, validateAllBeforeSave, workspaceId]);

  const syncFromServer = useCallback(async (): Promise<void> => {
    if (!workspaceId) return;

    setIsSyncing(true);
    try {
      const serverServices = await fetchServicesFromServer(workspaceId);
      // If the user switched workspaces while this sync was in flight, discard the
      // result — applying it would write the synced workspace's data into the
      // now-active workspace's state and localStorage (cross-workspace bleed).
      if (loadedWorkspaceRef.current !== workspaceId) return;
      // fetchServicesFromServer already ensures array, but double-check for safety
      const safeServices = Array.isArray(serverServices) ? serverServices : [];
      setServices(safeServices);
      loadFailedRef.current = false; // a successful sync recovers from a failed load
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
