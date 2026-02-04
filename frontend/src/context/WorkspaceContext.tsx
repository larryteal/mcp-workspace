import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';

const STORAGE_KEY = 'mcp-workspace:workspace-id';

function getStoredWorkspaceId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

function storeWorkspaceId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
}

function generateWorkspaceId(): string {
  return crypto.randomUUID();
}

interface WorkspaceContextType {
  workspaceId: string;
  setWorkspaceId: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Extract workspace ID from URL if present
  const urlMatch = location.pathname.match(/^\/workspace\/([^/]+)/);
  const urlWorkspaceId = urlMatch ? urlMatch[1] : null;

  // Initialize workspace ID: URL > localStorage > generate new
  const [workspaceId, setWorkspaceIdState] = useState<string>(() => {
    if (urlWorkspaceId) {
      storeWorkspaceId(urlWorkspaceId);
      return urlWorkspaceId;
    }
    const stored = getStoredWorkspaceId();
    if (stored) return stored;
    const newId = generateWorkspaceId();
    storeWorkspaceId(newId);
    return newId;
  });

  const setWorkspaceId = (id: string) => {
    storeWorkspaceId(id);
    setWorkspaceIdState(id);
  };

  // Sync workspace ID when URL changes
  useEffect(() => {
    if (urlWorkspaceId && urlWorkspaceId !== workspaceId) {
      setWorkspaceId(urlWorkspaceId);
    }
  }, [urlWorkspaceId]);

  // Redirect to workspace URL if on root
  useEffect(() => {
    if (location.pathname === '/') {
      navigate(`/workspace/${workspaceId}`, { replace: true });
    }
  }, [location.pathname, workspaceId, navigate]);

  return (
    <WorkspaceContext.Provider value={{ workspaceId, setWorkspaceId }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
