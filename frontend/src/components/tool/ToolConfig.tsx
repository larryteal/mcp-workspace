import React, { useEffect } from 'react';
import { ToolHeader } from './ToolHeader';
import { RequestCard } from './RequestCard';
import { ResponseCard } from './ResponseCard';
import { useMCP } from '@/context/MCPContext';
import { useTabs } from '@/context/TabContext';
import { useApiTest } from '@/hooks/useApiTest';
import { alertDialog } from '@/components/common';
import { validateTool } from '@/utils/validate';
import type { Tool } from '@/types';
import styles from './ToolConfig.module.css';

interface ToolConfigProps {
  tool: Tool;
  mcpId: string;
}

export function ToolConfig({ tool, mcpId }: ToolConfigProps) {
  const { updateTool, validateBeforeSave } = useMCP();
  const { updateTab, findTab } = useTabs();
  const { response, loading, runTest, clearResponse } = useApiTest();

  // Clear response when tool changes
  useEffect(() => {
    clearResponse();
  }, [tool.id, clearResponse]);

  const handleUpdate = (updates: Partial<Tool>) => {
    updateTool(mcpId, tool.id, updates);

    // Update tab title if name changed (use !== undefined so clearing the name to
    // '' also syncs the tab title, not just a truthy value).
    if (updates.name !== undefined) {
      const tab = findTab(mcpId, tool.id);
      if (tab) {
        updateTab(tab.id, { title: updates.name });
      }
    }
  };

  const handleTest = async () => {
    const error = validateBeforeSave(mcpId);
    if (error) {
      await alertDialog({ title: 'Validation Error', message: error });
      return;
    }
    // Field-level validation (same rules as save) before hitting the proxy.
    const fieldError = validateTool(tool, 'Tool');
    if (fieldError) {
      await alertDialog({ title: 'Validation Error', message: fieldError });
      return;
    }
    runTest(tool);
  };

  return (
    <div className={styles.container}>
      <ToolHeader
        tool={tool}
        onTest={handleTest}
        loading={loading}
      />
      <div className={styles.content}>
        <RequestCard tool={tool} onUpdate={handleUpdate} />
        <ResponseCard response={response} loading={loading} />
      </div>
    </div>
  );
}
