import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMcpConfig, getVertexConfig } from '../../main/resources/lib/config';

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

  it('should enable both toolsets, writes and every repository by default', () => {
    withConfig({});

    expect(getMcpConfig()).toMatchObject({
      toolsets: ['content', 'nodes'],
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
