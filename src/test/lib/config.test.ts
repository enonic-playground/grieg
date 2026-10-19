import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMcpConfig, getOauthConfig, getVertexConfig } from '../../main/resources/lib/config';

function withConfig(config: Record<string, string>) {
  vi.stubGlobal('app', { config });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getMcpConfig', () => {
  it('should leave mcp.user unset rather than defaulting to su', () => {
    withConfig({ 'mcp.token': 't' });

    expect(getMcpConfig().user).toBeUndefined();
  });

  it('should treat a blank mcp.user as unset', () => {
    withConfig({ 'mcp.user': '  ' });

    expect(getMcpConfig().user).toBeUndefined();
  });

  it('should split mcp.allowedHosts on commas and drop blanks', () => {
    withConfig({ 'mcp.user': 'editor', 'mcp.allowedHosts': ' cms.example.com, ,xp.local ' });

    expect(getMcpConfig()).toMatchObject({
      user: 'editor',
      allowedHosts: ['cms.example.com', 'xp.local'],
      allowedOrigins: [],
    });
  });

  it('should enable every toolset, writes and every repository by default', () => {
    withConfig({});

    expect(getMcpConfig()).toMatchObject({
      toolsets: ['content', 'nodes', 'workflows'],
      readOnly: false,
      nodeRepos: [],
    });
  });

  it('should read mcp.toolsets, mcp.readOnly and mcp.nodes.repos', () => {
    withConfig({
      'mcp.toolsets': 'nodes',
      'mcp.readOnly': 'TRUE',
      'mcp.nodes.repos': 'com.enonic.app.grieg, scratch',
    });

    expect(getMcpConfig()).toMatchObject({
      toolsets: ['nodes'],
      readOnly: true,
      nodeRepos: ['com.enonic.app.grieg', 'scratch'],
    });
  });

  it('should serve no toolsets when mcp.toolsets is present but blank', () => {
    withConfig({ 'mcp.toolsets': ' ' });

    expect(getMcpConfig().toolsets).toEqual([]);
  });
});

describe('getOauthConfig', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['yes', false],
    [' TRUE ', true],
  ] as const)('should read oauth.enabled %j as enabled=%s', (raw, enabled) => {
    withConfig(raw == null ? {} : { 'oauth.enabled': raw });

    expect(getOauthConfig().enabled).toBe(enabled);
  });

  it('should allow Claude and ChatGPT callbacks, 1 h access and 30 d refresh by default', () => {
    withConfig({});

    expect(getOauthConfig()).toEqual({
      enabled: false,
      redirectUris: [
        'https://claude.ai/api/mcp/auth_callback',
        'https://claude.com/api/mcp/auth_callback',
        'https://chatgpt.com/connector_platform_oauth_redirect',
      ],
      accessTokenTtlMs: 3_600_000,
      refreshTokenTtlMs: 2_592_000_000,
    });
  });

  it('should read oauth.redirectUris as a list, and blank as no redirect URIs', () => {
    withConfig({ 'oauth.redirectUris': ' https://a.example/cb , https://b.example/cb ' });
    expect(getOauthConfig().redirectUris).toEqual(['https://a.example/cb', 'https://b.example/cb']);

    withConfig({ 'oauth.redirectUris': ' ' });
    expect(getOauthConfig().redirectUris).toEqual([]);
  });

  it('should read the token lifetimes in seconds, down to 60', () => {
    withConfig({ 'oauth.accessTokenTtl': '60', 'oauth.refreshTokenTtl': ' 86400 ' });

    expect(getOauthConfig()).toMatchObject({
      accessTokenTtlMs: 60_000,
      refreshTokenTtlMs: 86_400_000,
    });
  });

  it.each(['59', '1.5', 'soon', '-1'])(
    'should fall back to the default lifetimes for %j',
    (raw) => {
      withConfig({ 'oauth.accessTokenTtl': raw, 'oauth.refreshTokenTtl': raw });

      expect(getOauthConfig()).toMatchObject({
        accessTokenTtlMs: 3_600_000,
        refreshTokenTtlMs: 2_592_000_000,
      });
    },
  );
});

describe('getVertexConfig', () => {
  it('should treat blank values as unset and default the model to gemini-3.1-flash-lite', () => {
    withConfig({ 'vertex.credentialsPath': ' ', 'vertex.project': ' ', 'vertex.model': ' ' });

    expect(getVertexConfig()).toEqual({
      credentialsPath: undefined,
      project: undefined,
      model: 'gemini-3.1-flash-lite',
    });
  });

  it('should read vertex.credentialsPath, vertex.project and vertex.model trimmed', () => {
    withConfig({
      'vertex.credentialsPath': ' /etc/xp/sa.json ',
      'vertex.project': ' acme-ai ',
      'vertex.model': ' gemini-3.7-flash ',
    });

    expect(getVertexConfig()).toEqual({
      credentialsPath: '/etc/xp/sa.json',
      project: 'acme-ai',
      model: 'gemini-3.7-flash',
    });
  });
});
