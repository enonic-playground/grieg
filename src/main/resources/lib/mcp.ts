// Minimal JSON-RPC 2.0 plumbing for the Model Context Protocol. Only the methods a
// stateless HTTP transport needs: no sessions, no server-initiated messages.

export const PROTOCOL_VERSION = '2025-06-18';

export const ErrorCode = {
  PARSE_ERROR: -32_700,
  INVALID_REQUEST: -32_600,
  METHOD_NOT_FOUND: -32_601,
  INVALID_PARAMS: -32_602,
  INTERNAL_ERROR: -32_603,
} as const;

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
};

export type ToolContent = { type: 'text'; text: string };

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => unknown;
};

export function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function failure(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export function toolResult(value: unknown, isError = false): Record<string, unknown> {
  const content: ToolContent[] = [{ type: 'text', text: JSON.stringify(value, null, 2) }];
  return { content, isError };
}

export function describe(tools: Tool[]): Record<string, unknown> {
  return {
    tools: tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  };
}

export function dispatch(
  request: JsonRpcRequest,
  tools: Tool[],
  serverInfo: { name: string; version: string },
): JsonRpcResponse | undefined {
  const id = request.id ?? null;

  // A notification (no id) gets no response body — `notifications/initialized` is the one
  // every client sends right after the handshake.
  if (request.id == null) return undefined;

  switch (request.method) {
    case 'initialize':
      return success(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo,
      });

    case 'ping':
      return success(id, {});

    case 'tools/list':
      return success(id, describe(tools));

    case 'tools/call': {
      const params = request.params ?? {};
      const name = params.name;
      const tool = tools.find((candidate) => candidate.name === name);
      if (tool == null) {
        return failure(id, ErrorCode.INVALID_PARAMS, `Unknown tool: ${String(name)}`);
      }

      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return success(id, toolResult(tool.handler(args)));
      } catch (e) {
        return success(id, toolResult({ error: String(e) }, true));
      }
    }

    default:
      return failure(id, ErrorCode.METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
  }
}
