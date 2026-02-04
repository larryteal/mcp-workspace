import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { ToolConfig } from '@/components/tool';
import { useMCP } from '@/context/MCPContext';

export function ToolConfigPage() {
  const { mcpId, toolId } = useParams<{ mcpId: string; toolId: string; workspaceId: string }>();
  const { getTool } = useMCP();

  if (!mcpId || !toolId) {
    return <Navigate to="/" replace />;
  }

  const tool = getTool(mcpId, toolId);

  if (!tool) {
    return (
      <div style={{ padding: '32px', color: 'var(--text-secondary)' }}>
        Tool not found.
      </div>
    );
  }

  return <ToolConfig tool={tool} mcpId={mcpId} />;
}
