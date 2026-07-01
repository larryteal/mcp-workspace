import { useState, useCallback, useRef } from 'react';
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
  // Monotonic id of the latest test request. A result is applied only if it's
  // still the latest — otherwise switching tools (which calls clearResponse)
  // would let an in-flight request render its response onto a different tool.
  const requestIdRef = useRef(0);

  const runTest = useCallback(async (tool: Tool) => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const result = await testApi(workspaceId, tool);
      if (reqId !== requestIdRef.current) return; // superseded (tool switched / re-tested)
      setResponse(result);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [workspaceId]);

  const clearResponse = useCallback(() => {
    // Invalidate any in-flight request so its result is discarded (not shown on
    // the tool we just switched to).
    requestIdRef.current++;
    setResponse(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    response,
    loading,
    error,
    runTest,
    clearResponse,
  };
}
