// What each client needs pasted. Every builder takes the key, or `KEY_PLACEHOLDER` once the
// one-time reveal has closed, so the instructions stay readable either way.

export const TOKEN_ENV = 'GRIEG_MCP_TOKEN';
export const KEY_PLACEHOLDER = '<your key>';
export const MCP_REMOTE = 'mcp-remote@0.14.3';

// The origin comes from the request's Host, so anything beyond a plain host and port stays out
// of a command meant to be pasted into a shell.
const SHELL_SAFE_URL =
  /^https?:\/\/(?:[a-z\d-]+(?:\.[a-z\d-]+)*|\[[a-f\d:.]+\])(?::\d+)?\/api\/[\w.-]+:mcp$/i;
const URL_PLACEHOLDER = '<endpoint URL>';

// mcp-remote refuses plain HTTP to anything but these without `--allow-http`.
const MCP_REMOTE_LOOPBACK = new Set(['localhost', '127.0.0.1']);

function needsAllowHttp(mcpUri: string): boolean {
  if (!/^http:\/\//i.test(mcpUri)) return false;
  try {
    return !MCP_REMOTE_LOOPBACK.has(new URL(mcpUri).hostname);
  } catch {
    return true;
  }
}

function shellUrl(mcpUri: string): string {
  return SHELL_SAFE_URL.test(mcpUri) ? mcpUri : URL_PLACEHOLDER;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// Reads the key without echoing it, so it stays out of the terminal and the shell history.
export function buildReadToken(): string {
  return `read -rs ${TOKEN_ENV} && export ${TOKEN_ENV}`;
}

export function buildClaudeCommand(mcpUri: string): string {
  return [
    `claude mcp add --transport http grieg "${shellUrl(mcpUri)}" \\`,
    `  --header "Authorization: Bearer $${TOKEN_ENV}"`,
  ].join('\n');
}

export function buildMcpJson(mcpUri: string): string {
  return json({
    mcpServers: {
      grieg: {
        type: 'http',
        url: mcpUri,
        headers: { Authorization: `Bearer \${${TOKEN_ENV}}` },
      },
    },
  });
}

// The header has no space and the key travels in `env`: Desktop on Windows does not quote
// arguments, so a space inside one would split it.
export function buildDesktopConfig(mcpUri: string, key: string): string {
  const args = ['-y', MCP_REMOTE, mcpUri, '--header', 'Authorization:${AUTH_HEADER}'];
  if (needsAllowHttp(mcpUri)) args.push('--allow-http');
  return json({
    mcpServers: {
      grieg: { command: 'npx', args, env: { AUTH_HEADER: `Bearer ${key}` } },
    },
  });
}

export function buildHttpConfig(mcpUri: string, key: string): string {
  return json({
    mcpServers: {
      grieg: { url: mcpUri, headers: { Authorization: `Bearer ${key}` } },
    },
  });
}

export function buildVsCodeConfig(mcpUri: string, key: string): string {
  return json({
    servers: {
      grieg: { type: 'http', url: mcpUri, headers: { Authorization: `Bearer ${key}` } },
    },
  });
}

export function buildStdioConfig(mcpUri: string, key: string): string {
  return json({
    mcpServers: {
      grieg: {
        command: 'node',
        args: ['/path/to/grieg/dev/mcp-stdio.ts'],
        env: { MCP_URL: mcpUri, MCP_TOKEN: key },
      },
    },
  });
}

export function buildCurlCheck(mcpUri: string): string {
  return [
    `curl -sX POST "${shellUrl(mcpUri)}" \\`,
    `  -H "Authorization: Bearer $${TOKEN_ENV}" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  ].join('\n');
}
