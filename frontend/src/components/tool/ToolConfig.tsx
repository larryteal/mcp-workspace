import React, { useEffect } from 'react';
import { ToolHeader } from './ToolHeader';
import { RequestCard } from './RequestCard';
import { ResponseCard } from './ResponseCard';
import { useMCP } from '@/context/MCPContext';
import { useTabs } from '@/context/TabContext';
import { useApiTest } from '@/hooks/useApiTest';
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

    // Update tab title if name changed
    if (updates.name) {
      const tab = findTab(mcpId, tool.id);
      if (tab) {
        updateTab(tab.id, { title: updates.name });
      }
    }
  };

  const handleTest = () => {
    const error = validateBeforeSave(mcpId);
    if (error) {
      alert(error);
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
