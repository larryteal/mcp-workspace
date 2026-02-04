import { useState, useCallback } from 'react';
import type { Tool, ApiResponse } from '@/types';
import { testApi } from '@/utils/api';
import { useWorkspace } from '@/context/WorkspaceContext';

interface UseApiTestReturn {
  response: ApiResponse | null;
  loading: boolean;
  error: string | null;
  runTest: (tool: Tool) => Promise<void>;
  clearResponse: () => void;
}

export function useApiTest(): UseApiTestReturn {
  const { workspaceId } = useWorkspace();
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = useCallback(async (tool: Tool) => {
    setLoading(true);
    setError(null);

    try {
      const result = await testApi(workspaceId, tool);
      setResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const clearResponse = useCallback(() => {
    setResponse(null);
    setError(null);
  }, []);

  return {
    response,
    loading,
    error,
    runTest,
    clearResponse,
  };
}
