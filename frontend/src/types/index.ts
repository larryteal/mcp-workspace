export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type BodyType = 'none' | 'raw-json' | 'form-data' | 'x-www-form-urlencoded' | 'binary';

export type ResponseFormat = 'raw' | 'preview';

export interface KeyValueItem {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
  description?: string;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  cookies: KeyValueItem[];
  bodyType: BodyType;
  bodyContent: string;
  bodyFormData: KeyValueItem[];
  bodyUrlEncoded: KeyValueItem[];
  inputSchema: string;
  outputSchema: string;
}

export interface MCPService {
  id: string;
  name: string;
  version: string;
  description: string;
  expanded: boolean;
  tools: Tool[];
}

export interface Tab {
  id: string;
  type: 'overview' | 'tool';
  mcpId: string;
  toolId?: string;
  title: string;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  time: number;
  size: string;
  headers: Record<string, string>;
  cookies: KeyValueItem[];
  body: string;
}

/**
 * Proxy test response - returned from backend after server-side API testing
 */
export interface ProxyTestResponse {
  status: number;
  statusText: string;
  time: number;
  size: string;
  headers: Record<string, string>;
  cookies: Array<{ key: string; value: string }>;
  body: string;
}
