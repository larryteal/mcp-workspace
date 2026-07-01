import { useState, useCallback, useRef } from 'react';
import type { Tool, ApiResponse } from '@/types';
import { testApi } from '@/utils/api';
import { useWorkspace } from '@/context/WorkspaceContext';

interface UseApiTestReturn {
  response: ApiResponse | null;
  loading: boolean;
  runTest: (tool: Tool) => Promise<void>;
  clearResponse: () => void;
}

export function useApiTest(): UseApiTestReturn {
  const { workspaceId } = useWorkspace();
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  // Monotonic id of the latest test request. A result is applied only if it's
  // still the latest — otherwise switching tools (which calls clearResponse)
  // would let an in-flight request render its response onto a different tool.
  const requestIdRef = useRef(0);

  const runTest = useCallback(async (tool: Tool) => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    // testApi never throws — it returns a status:0 response on failure (rendered
    // as an error by ResponseCard). The try/finally only guards `loading`.
    try {
      const result = await testApi(workspaceId, tool);
      if (reqId === requestIdRef.current) setResponse(result); // else superseded
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [workspaceId]);

  const clearResponse = useCallback(() => {
    // Invalidate any in-flight request so its result is discarded (not shown on
    // the tool we just switched to).
    requestIdRef.current++;
    setResponse(null);
    setLoading(false);
  }, []);

  return {
    response,
    loading,
    runTest,
    clearResponse,
  };
}
