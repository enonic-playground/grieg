import { describe, expect, it } from 'vitest';

import {
  buildAgentPrompt,
  buildClaudeCommand,
  buildCodexCommand,
  buildCodexToml,
  buildCurlCheck,
  buildCursorConfig,
  buildDesktopConfig,
  buildHttpConfig,
  buildMcpJson,
  buildReadToken,
  buildStdioConfig,
  buildVsCodeConfig,
} from '../../../../../main/resources/assets/js/components/mcp/snippets';

const MCP_URI = 'http://localhost:8080/api/com.enonic.app.grieg:mcp';
const KEY = 'grieg_x';

type ServerEntry = Record<string, unknown> & { args?: string[]; env?: Record<string, string> };

function entry(config: string): ServerEntry {
  return (JSON.parse(config) as { mcpServers: { grieg: ServerEntry } }).mcpServers.grieg;
}

describe('shell commands', () => {
  it.each([
    'http://localhost:8080/api/com.enonic.app.grieg:mcp',
    'https://cms.example.com/api/com.enonic.app.grieg:mcp',
    'http://[::1]:8080/api/com.enonic.app.grieg:mcp',
  ])('should keep the plain endpoint %s', (url) => {
    expect(buildClaudeCommand(url)).toContain(` "${url}" `);
    expect(buildCurlCheck(url)).toContain(` "${url}" `);
    expect(buildCodexCommand(url)).toContain(` "${url}" `);
    expect(buildCodexToml(url)).toContain(`url = "${url}"`);
    expect(buildAgentPrompt(url)).toContain(`- URL: \`${url}\`\n`);
  });

  it.each([
    'http://$(id).example/api/com.enonic.app.grieg:mcp',
    'http://a`id`.example/api/com.enonic.app.grieg:mcp',
    'http://a"b.example/api/com.enonic.app.grieg:mcp',
  ])('should leave a placeholder for the shell-unsafe endpoint %s', (url) => {
    for (const command of [buildClaudeCommand(url), buildCurlCheck(url), buildCodexCommand(url)]) {
      expect(command).toContain(' "<endpoint URL>" ');
      expect(command).not.toContain('example');
    }
    expect(buildCodexToml(url)).toContain('url = "<endpoint URL>"');
    expect(buildAgentPrompt(url)).toContain('- URL: `<endpoint URL>`\n');
    for (const text of [buildCodexToml(url), buildAgentPrompt(url)]) {
      expect(text).not.toContain('.example/');
    }
  });

  it('should leave the key to the shell to expand', () => {
    expect(buildClaudeCommand(MCP_URI)).toContain('"Authorization: Bearer $GRIEG_MCP_TOKEN"');
    expect(buildCurlCheck(MCP_URI)).toContain('"Authorization: Bearer $GRIEG_MCP_TOKEN"');
  });
});

describe('buildMcpJson', () => {
  it('should reference the key by environment variable only', () => {
    expect(entry(buildMcpJson(MCP_URI))).toEqual({
      type: 'http',
      url: MCP_URI,
      headers: { Authorization: 'Bearer ${GRIEG_MCP_TOKEN}' },
    });
  });
});

describe('buildDesktopConfig', () => {
  it('should pass the header without a space and the key through env', () => {
    const { args, env } = entry(buildDesktopConfig(MCP_URI, KEY));

    expect(args).toEqual([
      '-y',
      'mcp-remote@0.14.3',
      MCP_URI,
      '--header',
      'Authorization:${AUTH_HEADER}',
    ]);
    expect(args?.some((arg) => arg.includes(' '))).toBe(false);
    expect(env).toEqual({ AUTH_HEADER: `Bearer ${KEY}` });
  });

  it.each([
    ['http://cms.internal:8080/api/com.enonic.app.grieg:mcp', true],
    ['http://[::1]:8080/api/com.enonic.app.grieg:mcp', true],
    ['http://127.0.0.1:8080/api/com.enonic.app.grieg:mcp', false],
    ['https://cms.example.com/api/com.enonic.app.grieg:mcp', false],
  ])('should allow plain HTTP to %s only where mcp-remote needs it: %s', (url, allowed) => {
    expect(entry(buildDesktopConfig(url, KEY)).args?.includes('--allow-http')).toBe(allowed);
  });
});

describe('client configs', () => {
  it('should carry the key in the header of a remote entry', () => {
    expect(entry(buildHttpConfig(MCP_URI, KEY))).toEqual({
      url: MCP_URI,
      headers: { Authorization: `Bearer ${KEY}` },
    });
  });

  it('should use the servers schema VS Code reads', () => {
    expect(JSON.parse(buildVsCodeConfig(MCP_URI, KEY))).toEqual({
      servers: {
        grieg: { type: 'http', url: MCP_URI, headers: { Authorization: `Bearer ${KEY}` } },
      },
    });
  });

  it('should hand the stdio forwarder the endpoint and key', () => {
    expect(entry(buildStdioConfig(MCP_URI, KEY))).toEqual({
      command: 'node',
      args: ['/path/to/grieg/dev/mcp-stdio.ts'],
      env: { MCP_URL: MCP_URI, MCP_TOKEN: KEY },
    });
  });
});

describe('Codex', () => {
  it('should pass the key only by the name of its environment variable', () => {
    expect(buildCodexCommand(MCP_URI)).toBe(
      `codex mcp add grieg --url "${MCP_URI}" --bearer-token-env-var GRIEG_MCP_TOKEN`,
    );
    expect(buildCodexToml(MCP_URI)).toBe(
      `[mcp_servers.grieg]\nurl = "${MCP_URI}"\nbearer_token_env_var = "GRIEG_MCP_TOKEN"`,
    );
  });
});

describe('buildCursorConfig', () => {
  it('should reference the key through Cursor env interpolation only', () => {
    expect(entry(buildCursorConfig(MCP_URI))).toEqual({
      url: MCP_URI,
      headers: { Authorization: 'Bearer ${env:GRIEG_MCP_TOKEN}' },
    });
  });
});

describe('buildAgentPrompt', () => {
  it('should name the variable and the endpoint check, and hold no key', () => {
    const prompt = buildAgentPrompt(MCP_URI);

    expect(prompt).toContain(`- URL: \`${MCP_URI}\`\n`);
    expect(prompt).toContain('environment variable `GRIEG_MCP_TOKEN`');
    expect(prompt).toContain(`\`${buildReadToken()}\``);
    expect(prompt.split('\n\n').at(-1)).toBe(`\`\`\`bash\n${buildCurlCheck(MCP_URI)}\n\`\`\``);
    expect(prompt).not.toMatch(/grieg_[A-Za-z0-9]/);
  });
});
