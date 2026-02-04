import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { MCPOverview } from '@/components/mcp';
import { useMCP } from '@/context/MCPContext';

export function MCPOverviewPage() {
  const { mcpId } = useParams<{ mcpId: string; workspaceId: string }>();
  const { getService } = useMCP();

  if (!mcpId) {
    return <Navigate to="/" replace />;
  }

  const service = getService(mcpId);

  if (!service) {
    return (
      <div style={{ padding: '32px', color: 'var(--text-secondary)' }}>
        MCP service not found.
      </div>
    );
  }

  return <MCPOverview service={service} />;
}
