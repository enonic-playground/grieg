// Who may reach the MCP endpoint. The API descriptor admits everyone, so these checks are the
// whole gate.

import type { McpConfig, ToolsConfig } from './config';

import { safeEqual } from './mcp';

const BEARER_PREFIX = 'Bearer ';
const TRUSTED_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// No `URL` in XP's script engine, so the origin is split by hand.
const ORIGIN_PATTERN = /^([a-z][a-z\d+.-]*):\/\/([^/?#@\s]+)$/i;
const DEFAULT_PORTS: Record<string, string> = { http: ':80', https: ':443' };

export type AccessRequest = {
  // Case-insensitive lookup, `undefined` when the header is absent.
  header: (name: string) => string | undefined;
  cookieNames: string[];
  // From `originOf` over XP's request scheme, host and port, which apply `X-Forwarded-*`.
  origin: string;
};

export type Rejection =
  | { status: 401; reason: string }
  | { status: 403; reason: string; message: string };

export type Access = { config: ToolsConfig } | { rejection: Rejection };

function forbidden(message: string, reason: string): { rejection: Rejection } {
  return { rejection: { status: 403, message, reason } };
}

function unauthorized(reason: string): { rejection: Rejection } {
  return { rejection: { status: 401, reason } };
}

export function originOf(scheme: string, host: string, port: number): string {
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return normalizeOrigin(`${scheme}://${bracketed}:${port}`) ?? '';
}

function normalizeOrigin(origin: string): string | undefined {
  const match = ORIGIN_PATTERN.exec(origin.toLowerCase());
  if (match == null) return undefined;
  const [, scheme, authority] = match;
  const defaultPort = DEFAULT_PORTS[scheme];
  const trimmed =
    defaultPort != null && authority.endsWith(defaultPort)
      ? authority.slice(0, -defaultPort.length)
      : authority;
  return `${scheme}://${trimmed}`;
}

function hostnameOf(authority: string): string {
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    return end < 0 ? authority : authority.slice(0, end + 1);
  }
  const colon = authority.indexOf(':');
  return colon < 0 ? authority : authority.slice(0, colon);
}

// Entries may carry a port or a bare IPv6 address; reduce them to the form `hostnameOf` returns.
function allowedHostOf(entry: string): string {
  const lower = entry.toLowerCase();
  const isBareIpv6 = !lower.startsWith('[') && lower.split(':').length > 2;
  return isBareIpv6 ? `[${lower}]` : hostnameOf(lower);
}

function cookieNamesOf(request: AccessRequest): string[] {
  if (request.cookieNames.length > 0) return request.cookieNames;
  return (request.header('Cookie') ?? '')
    .split(';')
    .map((pair) => pair.split('=')[0].trim())
    .filter((name) => name !== '');
}

// Cookie values are session secrets, so only the names are reported.
function checkCookies(request: AccessRequest): { rejection: Rejection } | undefined {
  if (request.header('Cookie') == null && request.cookieNames.length === 0) return undefined;

  const names = cookieNamesOf(request).join(', ') || '(unnamed)';
  return forbidden(
    'Requests carrying cookies are not accepted',
    `request carries cookies (${names}); MCP clients send none, so a browser session is never admitted`,
  );
}

// In a DNS-rebinding attack Origin and Host both name the attacker's host, so same-origin alone
// proves nothing: the host must also be trusted.
function checkOrigin(
  request: AccessRequest,
  config: McpConfig,
): { rejection: Rejection } | undefined {
  const origin = request.header('Origin');
  if (origin == null || config.allowedOrigins.includes(origin)) return undefined;

  if (normalizeOrigin(origin) !== request.origin) {
    return forbidden(
      `Origin not allowed: ${origin}`,
      `Origin '${origin}' is not same-origin with this request (${request.origin}); add it to \`mcp.allowedOrigins\``,
    );
  }

  const hostname = hostnameOf(request.origin.slice(request.origin.indexOf('://') + 3));
  const trusted = [...TRUSTED_HOSTS, ...config.allowedHosts.map(allowedHostOf)];
  if (!trusted.includes(hostname)) {
    return forbidden(
      `Host not allowed: ${hostname}`,
      `Host '${hostname}' is not trusted for Origin '${origin}'; add it to \`mcp.allowedHosts\` or the origin to \`mcp.allowedOrigins\``,
    );
  }
  return undefined;
}

export function checkAccess(request: AccessRequest, config: McpConfig): Access {
  const refused = checkCookies(request) ?? checkOrigin(request, config);
  if (refused != null) return refused;

  const { token, user } = config;
  if (token == null) {
    return unauthorized('endpoint is disabled, set `mcp.token` in the app config');
  }
  if (user == null) {
    return unauthorized('endpoint is disabled, set `mcp.user` in the app config');
  }

  const header = request.header('Authorization');
  if (header == null || !header.startsWith(BEARER_PREFIX)) {
    return unauthorized('missing bearer token');
  }
  if (!safeEqual(header.slice(BEARER_PREFIX.length), token)) {
    return unauthorized('invalid bearer token');
  }
  return { config: { ...config, user } };
}
