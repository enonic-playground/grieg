import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMcpConfig } from '../../main/resources/lib/config';

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
});
