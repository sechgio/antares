import { _invoke } from './core';

export interface McpServer {
  id: string;
  name: string;
  transport: 'http' | 'stdio';
  url: string;
  command: string;
  args: string[];
  secret_keys: string[];
  tools_count: number | null;
  disabled_tools?: string[];
  oauth?: { token_url: string; client_id: string; scopes: string[] } | null;
}

export interface McpTool {
  name: string;
  description: string;
  enabled?: boolean;
}

export const mcpApi = {
  mcpServersList: () => _invoke<{ servers: McpServer[] }>('mcp_servers_list'),

  mcpServerAdd: (p: {
    name: string;
    transport: 'http' | 'stdio';
    url?: string;
    command?: string;
    args?: string[];
    secrets?: { headers?: Record<string, string>; env?: Record<string, string> };
    oauth?: { token_url: string; client_id: string; client_secret?: string; scopes?: string[] };
  }) => _invoke<{ server: McpServer }>('mcp_server_add', p),

  mcpServerDelete: (server: string) =>
    _invoke<{ deleted: boolean; id: string }>('mcp_server_delete', { server }),

  mcpServerTools: (server: string) =>
    _invoke<{ tools: McpTool[] }>('mcp_server_tools', { server }),

  mcpServerToolSet: (server: string, tool: string, enabled: boolean) =>
    _invoke<{ tool: McpTool }>('mcp_server_tool_set', { server, tool, enabled }),
};
