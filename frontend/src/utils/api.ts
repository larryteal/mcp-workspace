import axios from 'axios';
import type { Tool, ApiResponse } from '@/types';
import { proxyTestTool } from '@/services/storage';

/**
 * Test API through backend proxy
 * Uses unified ToolRequestPayload format
 */
export async function testApi(workspaceId: string, tool: Tool): Promise<ApiResponse> {
  try {
    const proxyResponse = await proxyTestTool(workspaceId, tool);

    return {
      status: proxyResponse.status,
      statusText: proxyResponse.statusText,
      time: proxyResponse.time,
      size: proxyResponse.size,
      headers: proxyResponse.headers,
      cookies: proxyResponse.cookies.map((c, index) => ({
        id: `cookie-${index}`,
        enabled: true,
        key: c.key,
        value: c.value,
      })),
      body: proxyResponse.body,
    };
  } catch (error) {
    // Prefer the backend's reason: validation 400s carry `{ error }`, and the
    // 502 execution path (incl. the localhost-guard rejection) carries it in
    // `statusText`. Fall back to the generic axios message.
    let errorMessage = error instanceof Error ? error.message : 'Proxy test failed';
    if (axios.isAxiosError(error) && error.response?.data) {
      const data = error.response.data as { statusText?: unknown; error?: unknown };
      if (typeof data.statusText === 'string' && data.statusText) {
        errorMessage = data.statusText;
      } else if (typeof data.error === 'string' && data.error) {
        errorMessage = data.error;
      }
    }
    return {
      status: 0,
      statusText: errorMessage,
      time: 0,
      size: '0 B',
      headers: {},
      cookies: [],
      body: '',
    };
  }
}
