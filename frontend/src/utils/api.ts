import axios from 'axios';
import type { Tool, ApiResponse } from '@/types';
import { proxyTestTool } from '@/services/storage';

const api = axios.create({
  timeout: 30000,
});

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
    const errorMessage = error instanceof Error ? error.message : 'Proxy test failed';
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

export default api;
