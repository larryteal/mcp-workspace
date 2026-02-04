import React, { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { AppLayout, EmptyState } from '@/components/layout';
import { MCPOverviewPage, ToolConfigPage } from '@/pages';
import { MCPProvider, useMCP } from '@/context/MCPContext';
import { TabProvider, useTabs } from '@/context/TabContext';
import { DirtyProvider, useDirty } from '@/context/DirtyContext';
import { WorkspaceProvider, useWorkspace } from '@/context/WorkspaceContext';

/**
 * Component to sync MCPContext state changes to DirtyContext
 */
function DirtyStateSync() {
  const { services, setOnServicesChange, setOnServerSnapshotLoaded } = useMCP();
  const { updateCurrentState, setServerSnapshot } = useDirty();

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

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setSelectedMcpId, setSelectedToolId, isLoading, dataLoaded, getService, getTool } = useMCP();
  const { activeTabId, tabs, openTab } = useTabs();
  const { workspaceId } = useWorkspace();

  // Track if initial URL navigation has been handled (prevents reopening tabs after intentional close)
  const initialUrlHandled = useRef(false);

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
    if (activeTabId) {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab) {
        // Sync sidebar selection with active tab
        setSelectedMcpId(activeTab.mcpId);
        setSelectedToolId(activeTab.type === 'tool' ? activeTab.toolId || null : null);

        // Sync navigation
        if (activeTab.type === 'overview') {
          navigate(`/workspace/${workspaceId}/mcp/${activeTab.mcpId}/overview`);
        } else if (activeTab.type === 'tool' && activeTab.toolId) {
          navigate(`/workspace/${workspaceId}/mcp/${activeTab.mcpId}/tool/${activeTab.toolId}`);
        }
      }
    } else {
      // No active tab, clear selection and navigate to workspace root
      setSelectedMcpId(null);
      setSelectedToolId(null);
      navigate(`/workspace/${workspaceId}`);
    }
  }, [activeTabId, tabs, navigate, setSelectedMcpId, setSelectedToolId, workspaceId]);

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
    <BrowserRouter>
      <WorkspaceProvider>
        <MCPProvider>
          <DirtyProvider>
            <DirtyStateSync />
            <TabProvider>
              <AppContent />
            </TabProvider>
          </DirtyProvider>
        </MCPProvider>
      </WorkspaceProvider>
    </BrowserRouter>
  );
}
