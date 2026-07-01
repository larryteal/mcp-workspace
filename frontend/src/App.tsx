import React, { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { AppLayout, EmptyState } from '@/components/layout';
import { MCPOverviewPage, ToolConfigPage } from '@/pages';
import { MCPProvider, useMCP } from '@/context/MCPContext';
import { TabProvider, useTabs } from '@/context/TabContext';
import { DirtyProvider, useDirty } from '@/context/DirtyContext';
import { WorkspaceProvider, useWorkspace } from '@/context/WorkspaceContext';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';

/**
 * Component to sync MCPContext state changes to DirtyContext
 */
function DirtyStateSync() {
  const { services, setOnServicesChange, setOnServerSnapshotLoaded } = useMCP();
  const { updateCurrentState, setServerSnapshot, hasAnyDirty } = useDirty();

  // Warn before leaving/reloading the page if there are unsaved changes.
  // (Edits are persisted to localStorage so data isn't lost, but they haven't
  // been pushed to the server yet — surface that instead of leaving silently.)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasAnyDirty()) {
        e.preventDefault();
        // Legacy browsers require returnValue to be set to trigger the prompt.
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasAnyDirty]);

  // Initialize DirtyContext with current services on mount
  useEffect(() => {
    updateCurrentState(services);
  }, []);

  // Set up callback to receive services updates
  useEffect(() => {
    setOnServicesChange(updateCurrentState);
  }, [setOnServicesChange, updateCurrentState]);

  // Set up callback to receive server snapshot (for dirty tracking)
  useEffect(() => {
    setOnServerSnapshotLoaded(setServerSnapshot);
  }, [setOnServerSnapshotLoaded, setServerSnapshot]);

  // Sync services changes
  useEffect(() => {
    updateCurrentState(services);
  }, [services, updateCurrentState]);

  return null;
}

/**
 * Route guard component that validates MCP/tool existence and redirects if not found
 */
function ValidatedMCPOverviewPage() {
  const navigate = useNavigate();
  const { mcpId } = useParams<{ mcpId: string }>();
  const { services, getService, dataLoaded } = useMCP();
  const { workspaceId } = useWorkspace();

  useEffect(() => {
    if (dataLoaded && mcpId) {
      const service = getService(mcpId);
      if (!service) {
        // MCP not found - if workspace is empty, redirect to home to get new workspace
        // Otherwise redirect to workspace page
        if (services.length === 0) {
          navigate('/', { replace: true });
        } else {
          navigate(`/workspace/${workspaceId}`, { replace: true });
        }
      }
    }
  }, [dataLoaded, mcpId, services.length, getService, navigate, workspaceId]);

  if (!dataLoaded) {
    return null; // Loading state handled by AppContent
  }

  const service = mcpId ? getService(mcpId) : undefined;
  if (!service) {
    return null; // Redirect will happen via useEffect
  }

  return <MCPOverviewPage />;
}

/**
 * Route guard component that validates tool existence and redirects if not found
 */
function ValidatedToolConfigPage() {
  const navigate = useNavigate();
  const { mcpId, toolId } = useParams<{ mcpId: string; toolId: string }>();
  const { services, getTool, getService, dataLoaded } = useMCP();
  const { workspaceId } = useWorkspace();

  useEffect(() => {
    if (dataLoaded && mcpId) {
      const service = getService(mcpId);
      if (!service) {
        // MCP not found - if workspace is empty, redirect to home to get new workspace
        if (services.length === 0) {
          navigate('/', { replace: true });
        } else {
          navigate(`/workspace/${workspaceId}`, { replace: true });
        }
        return;
      }
      if (toolId) {
        const tool = getTool(mcpId, toolId);
        if (!tool) {
          // Tool not found, redirect to workspace page
          navigate(`/workspace/${workspaceId}`, { replace: true });
        }
      }
    }
  }, [dataLoaded, mcpId, toolId, services.length, getService, getTool, navigate, workspaceId]);

  if (!dataLoaded) {
    return null; // Loading state handled by AppContent
  }

  const tool = mcpId && toolId ? getTool(mcpId, toolId) : undefined;
  if (!tool) {
    return null; // Redirect will happen via useEffect
  }

  return <ToolConfigPage />;
}

/**
 * Scopes tab state to the current workspace. The `key={workspaceId}` forces a
 * clean remount of TabProvider + AppContent (clearing tabs and AppContent's
 * `initialUrlHandled` ref) if the workspace ever changes without a full reload.
 * No effect today — workspaceId is stable within a session — but it future-proofs
 * an in-session workspace switcher against stale tabs / a latched initial-URL flag.
 */
function TabScope() {
  const { workspaceId } = useWorkspace();
  return (
    <TabProvider key={workspaceId}>
      <AppContent />
    </TabProvider>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setSelectedMcpId, setSelectedToolId, isLoading, dataLoaded, getService, getTool } = useMCP();
  const { activeTabId, tabs, openTab, closeTab, updateTab } = useTabs();
  const { workspaceId } = useWorkspace();

  // Track if initial URL navigation has been handled (prevents reopening tabs after intentional close)
  const initialUrlHandled = useRef(false);

  // Prune tabs pointing at a service/tool that no longer exists — e.g. after Sync
  // replaced the local state with the server's (which may have removed them).
  // Without this a stale "ghost" tab lingers in the bar pointing at a missing
  // entity, leaving the UI in a confusing, hard-to-recover state.
  // (getService/getTool change identity when `services` changes, so this re-runs
  // after a sync. Local deletes already close their own tab before removal.)
  useEffect(() => {
    if (!dataLoaded) return;
    for (const tab of tabs) {
      const service = getService(tab.mcpId);
      const tool = tab.toolId ? getTool(tab.mcpId, tab.toolId) : undefined;
      const valid = !!service && (tab.type === 'overview' || !!tool);
      if (!valid) {
        closeTab(tab.id);
        continue;
      }
      // Keep the tab title in sync with the tool's current name (e.g. after a
      // Sync renamed it on the server); overview tabs have a static title.
      if (tab.type === 'tool' && tool && tab.title !== tool.name) {
        updateTab(tab.id, { title: tool.name });
      }
    }
  }, [dataLoaded, tabs, getService, getTool, closeTab, updateTab]);

  // Handle direct URL navigation - only on initial load when no tabs exist
  useEffect(() => {
    if (!dataLoaded || tabs.length > 0 || initialUrlHandled.current) return;

    const match = location.pathname.match(/^\/workspace\/[^/]+\/mcp\/([^/]+)(?:\/(overview|tool)(?:\/([^/]+))?)?/);
    if (match) {
      const [, mcpId, type, toolId] = match;
      const service = getService(mcpId);

      if (service) {
        if (type === 'tool' && toolId) {
          const tool = getTool(mcpId, toolId);
          if (tool) {
            openTab({ type: 'tool', mcpId, toolId, title: tool.name });
          }
        } else if (type === 'overview') {
          openTab({ type: 'overview', mcpId, title: 'Overview' });
        }
      }
    }
    // Mark as handled so we don't reopen tabs after user closes them
    initialUrlHandled.current = true;
  }, [dataLoaded, location.pathname, tabs.length, getService, getTool, openTab]);

  // Sync navigation and selection with active tab
  useEffect(() => {
    // Wait until data is loaded: on first mount activeTabId is null, and without
    // this guard the else-branch below would navigate to the workspace root and
    // strip a deep-link URL (/mcp/:id/...) before the initial-URL effect (which
    // also waits for dataLoaded) gets a chance to open the corresponding tab.
    if (!dataLoaded) return;
    if (activeTabId) {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab) {
        // Sync sidebar selection with active tab
        setSelectedMcpId(activeTab.mcpId);
        setSelectedToolId(activeTab.type === 'tool' ? activeTab.toolId || null : null);

        // Sync navigation — but only when the URL actually needs to change. This
        // effect also re-runs when a tab's TITLE changes (e.g. typing in the Tool
        // Name field mutates `tabs`); navigating to the already-current URL would
        // push a duplicate history entry on every keystroke. (No `replace` here so
        // genuine tab switches still add history for the back button.)
        const targetPath =
          activeTab.type === 'overview'
            ? `/workspace/${workspaceId}/mcp/${activeTab.mcpId}/overview`
            : activeTab.type === 'tool' && activeTab.toolId
              ? `/workspace/${workspaceId}/mcp/${activeTab.mcpId}/tool/${activeTab.toolId}`
              : null;
        if (targetPath && targetPath !== location.pathname) {
          navigate(targetPath);
        }
      }
    } else {
      // No active tab, clear selection and navigate to workspace root.
      // Use replace so the transient root navigation during deep-link load (the
      // frame before openTab's activeTabId applies) doesn't push a junk history
      // entry that the back button would land on.
      setSelectedMcpId(null);
      setSelectedToolId(null);
      navigate(`/workspace/${workspaceId}`, { replace: true });
    }
  }, [activeTabId, tabs, dataLoaded, navigate, setSelectedMcpId, setSelectedToolId, workspaceId]);

  // Show loading spinner while fetching data
  if (isLoading) {
    return (
      <AppLayout>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Loading...</span>
        </div>
      </AppLayout>
    );
  }

  // Show empty state when no tabs are open
  if (tabs.length === 0) {
    return (
      <AppLayout>
        <EmptyState />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<EmptyState />} />
        <Route path="/workspace/:workspaceId" element={<EmptyState />} />
        <Route path="/workspace/:workspaceId/mcp/:mcpId/overview" element={<ValidatedMCPOverviewPage />} />
        <Route path="/workspace/:workspaceId/mcp/:mcpId/tool/:toolId" element={<ValidatedToolConfigPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <WorkspaceProvider>
          <MCPProvider>
            <DirtyProvider>
              <DirtyStateSync />
              <TabScope />
            </DirtyProvider>
          </MCPProvider>
        </WorkspaceProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
