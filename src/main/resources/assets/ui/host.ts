import type { JsonObject } from './shapes';
import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';

export type ToolCall = { ok: true; data: unknown } | { ok: false; message: string };

// What a card may ask of the host. Reads go to the server through the host; a write is only
// ever asked of Claude, so it runs behind the host's approval prompt.
export type CardHost = {
  callTool: (name: string, args: JsonObject) => Promise<ToolCall>;
  // `false` when the host refused or could not deliver the message.
  ask: (request: string) => Promise<boolean>;
  openLink: (url: string) => void;
};

type ToolResult = { isError?: boolean; content?: unknown[]; structuredContent?: unknown };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function textOf(result: ToolResult): string {
  return (result.content ?? [])
    .flatMap((item) =>
      typeof item === 'object' && item != null && 'text' in item && typeof item.text === 'string'
        ? [item.text]
        : [],
    )
    .join('\n');
}

export function readResult(result: ToolResult): ToolCall {
  if (result.isError === true) return { ok: false, message: textOf(result) || 'The tool failed.' };
  if (result.structuredContent == null) {
    return { ok: false, message: 'The tool returned no structured result.' };
  }
  return { ok: true, data: result.structuredContent };
}

export function createHost(app: App): CardHost {
  return {
    callTool: async (name, args) => {
      try {
        return readResult(await app.callServerTool({ name, arguments: args }));
      } catch (e) {
        return { ok: false, message: errorMessage(e) };
      }
    },
    ask: async (request) => {
      try {
        const result = await app.sendMessage({
          role: 'user',
          content: [{ type: 'text', text: request }],
        });
        return result.isError !== true;
      } catch {
        return false;
      }
    },
    openLink: (url) => {
      void app.openLink({ url }).catch(() => undefined);
    },
  };
}

export function localeOf(context: McpUiHostContext | undefined): string {
  return context?.locale ?? navigator.language;
}
