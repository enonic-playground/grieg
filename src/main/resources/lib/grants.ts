// `lib/keys.ts` imports this module, so nothing here may import `lib/keys.ts`.
//
// lib-node has no lock or version check: each consume writes, then reads back to see whether it
// won. Two requests whose reads both precede either write can both win, so each node keeps a
// single writer where it can; that is why `lastUsed` lives on the access node, not the grant.

import { log as auditLog } from '/lib/xp/auditlog';

import type { AuthorizeRequest } from './oauth';
import type { Node } from '/lib/xp/node';

import { randomToken, sha256Base64Url, sha256Hex } from './key-crypto';
import { matchRefresh, tokenError, verifyPkce, type TokenError } from './oauth';
import { BRANCH, ensureAdminFolder, getConnection, REPO_ID, runInRepo } from './repo';
import { redactKeys } from './text';

const ROOT = '/mcp/oauth';
export const GRANTS_PATH = `${ROOT}/grants`;
const CODES_PATH = `${ROOT}/codes`;
const ACCESS_PATH = `${ROOT}/access`;

const ACCESS_PREFIX = 'grieg_';
const CODE_TTL_MS = 60 * 1000;
// A grant ends 90 days after consent however often it is refreshed, as a personal key does.
const GRANT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const MAX_GRANTS_PER_OWNER = 20;
const MAX_NODES = 10_000;
const TOKEN_PATTERN = /^[\w-]{43}$/;
const GRANT_ID_PATTERN = /^[\da-f]{64}$/;

type CodeData = {
  owner: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource: string;
  scope?: string;
  expires: string;
  // Set once the code is exchanged, and kept until it expires, so a replay finds its grant.
  grant?: string;
  // Set by a replay that came before the grant existed, so its exchange revokes it.
  replayed?: boolean;
};

type GrantData = {
  owner: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope?: string;
  created: string;
  expires: string;
  // Carried over from the access keys a refresh drops; the live keys hold the latest use.
  lastUsed?: string;
  refresh: string;
  refreshExpires: string;
  previousRefresh?: string;
  rotated?: string;
  // The access key issued with the current refresh token, and the one before it, which stays
  // valid until its own expiry so requests already in flight at a refresh do not fail.
  access: string;
  previousAccess?: string;
};

type AccessData = { grant: string; expires: string; lastUsed?: string };

export type Grant = {
  id: string;
  owner: string;
  clientId: string;
  redirectUri: string;
  created: string;
  expires: string;
  // When it stops working: `expires`, or earlier once it goes unrefreshed past the refresh TTL.
  ends: string;
  lastUsed?: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
};

export type Lifetimes = { accessTokenTtlMs: number; refreshTokenTtlMs: number };

// Refuses an owner who no longer exists, is disabled or lost the MCP role; `lib/keys.ts`
// `checkOwner` in production.
export type OwnerCheck = (owner: string) => { refusal: string } | { admin: boolean };

export type AccessResolution = { owner: string; clientId: string } | { reason: string };

type Deps = Lifetimes & { checkOwner: OwnerCheck };

function latest(...dates: (string | undefined)[]): string | undefined {
  return dates.reduce<string | undefined>(
    (best, date) => (date != null && (best == null || date > best) ? date : best),
    undefined,
  );
}

// Call inside `runInRepo`.
function toGrant(node: Node<GrantData>): Grant {
  const used = [node.access, node.previousAccess]
    .filter((digest) => digest != null)
    .map((digest) => getConnection().get<AccessData>(accessPath(digest))?.lastUsed);
  return {
    id: node._name,
    owner: node.owner,
    clientId: node.clientId,
    redirectUri: node.redirectUri,
    created: node.created,
    expires: node.expires,
    ends: earliest(node.expires, node.refreshExpires),
    lastUsed: latest(node.lastUsed, ...used),
  };
}

function isPast(iso: string, now: Date): boolean {
  return !(Date.parse(iso) > now.getTime());
}

function later(now: Date, ms: number): string {
  return new Date(now.getTime() + ms).toISOString();
}

function earliest(a: string, b: string): string {
  return Date.parse(a) < Date.parse(b) ? a : b;
}

function grantPath(id: string): string {
  return `${GRANTS_PATH}/${id}`;
}

function accessPath(digest: string): string {
  return `${ACCESS_PATH}/${digest}`;
}

function audit(type: 'grant' | 'revoke', node: Node<GrantData>, reason?: string): void {
  try {
    auditLog({
      type: `grieg.oauth.${type}`,
      user: node.owner as `user:${string}:${string}`,
      objects: [`${REPO_ID}:${BRANCH}:${node._id}`],
      data: {
        clientId: node.clientId,
        redirectUri: node.redirectUri,
        ...(reason == null ? {} : { reason }),
      },
    });
  } catch (e) {
    log.warning(
      `OAuth could not write the audit log entry for a ${type}: ${redactKeys(String(e))}`,
    );
  }
}

function ensureFolders(): void {
  ensureAdminFolder('/', 'mcp');
  ensureAdminFolder('/mcp', 'oauth');
  ensureAdminFolder(ROOT, 'grants');
  ensureAdminFolder(ROOT, 'codes');
  ensureAdminFolder(ROOT, 'access');
}

// Call inside `runInRepo`.
function childIds(parentPath: string, owner?: string): string[] {
  const connection = getConnection();
  connection.refresh('SEARCH');
  const parent = { term: { field: '_parentPath', value: parentPath } };
  const result = connection.query({
    count: MAX_NODES,
    query:
      owner == null
        ? parent
        : { boolean: { must: [parent, { term: { field: 'owner', value: owner } }] } },
  });
  if (result.total > result.hits.length) {
    log.warning(
      `OAuth query under ${parentPath} returned ${result.hits.length} of ${result.total}`,
    );
  }
  return result.hits.map((hit) => hit.id);
}

function getAll<T>(ids: string[]): Node<T>[] {
  if (ids.length === 0) return [];
  const nodes = getConnection().get<T>(ids);
  if (nodes == null) return [];
  return Array.isArray(nodes) ? nodes : [nodes];
}

// Call inside `runInRepo`.
function deleteGrant(node: Node<GrantData>, reason: string): void {
  const connection = getConnection();
  const access = [node.access, node.previousAccess].filter((digest) => digest != null);
  connection.delete(node._id);
  for (const digest of access) connection.delete(accessPath(digest));
  audit('revoke', node, reason);
}

function getGrant(id: string): Node<GrantData> | undefined {
  if (!GRANT_ID_PATTERN.test(id)) return undefined;
  return getConnection().get<GrantData>(grantPath(id)) ?? undefined;
}

export function initGrantStore(now = new Date()): void {
  runInRepo(() => {
    ensureFolders();
    sweep(now);
  });
}

// Removes expired codes, expired access keys and ended grants. Call inside `runInRepo`.
function sweep(now: Date): void {
  const connection = getConnection();
  const expired = <T extends { expires: string }>(path: string): Node<T>[] =>
    getAll<T>(childIds(path)).filter((node) => isPast(node.expires, now));

  const codes = expired<CodeData>(CODES_PATH).map((node) => node._id);
  if (codes.length > 0) connection.delete(codes);
  const access = expired<AccessData>(ACCESS_PATH).map((node) => node._id);
  if (access.length > 0) connection.delete(access);
  for (const grant of getAll<GrantData>(childIds(GRANTS_PATH))) {
    if (isPast(grant.expires, now) || isPast(grant.refreshExpires, now)) {
      deleteGrant(grant, 'expired');
    }
  }
}

// Returns the plaintext code; only its digest is stored. Sweeps expired nodes first, best effort.
export function issueCode(owner: string, request: AuthorizeRequest, now = new Date()): string {
  const code = randomToken();
  runInRepo(() => {
    try {
      sweep(now);
    } catch (e) {
      log.warning(`OAuth sweep failed: ${redactKeys(String(e))}`);
    }
    getConnection().create<CodeData>({
      _name: sha256Hex(code),
      _parentPath: CODES_PATH,
      _inheritsPermissions: true,
      owner,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      challenge: request.challenge,
      resource: request.resource,
      scope: request.scope,
      expires: later(now, CODE_TTL_MS),
    });
  });
  return code;
}

export type CodeExchange = {
  code: string;
  clientId: string;
  redirectUri: string;
  verifier?: string;
  resource?: string;
};

// Call inside `runInRepo`.
function issueTokens(
  id: string,
  now: Date,
  { accessTokenTtlMs, refreshTokenTtlMs }: Lifetimes,
): { response: TokenResponse; access: string; refresh: string; refreshExpires: string } {
  const accessToken = `${ACCESS_PREFIX}${randomToken()}`;
  const refreshToken = `${id}.${randomToken()}`;
  const access = sha256Hex(accessToken);
  getConnection().create<AccessData>({
    _name: access,
    _parentPath: ACCESS_PATH,
    _inheritsPermissions: true,
    grant: id,
    expires: later(now, accessTokenTtlMs),
  });
  return {
    response: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(accessTokenTtlMs / 1000),
      refresh_token: refreshToken,
    },
    access,
    refresh: sha256Hex(refreshToken),
    refreshExpires: later(now, refreshTokenTtlMs),
  };
}

function capGrants(owner: string): void {
  const grants = getAll<GrantData>(childIds(GRANTS_PATH, owner)).sort((a, b) =>
    b.created.localeCompare(a.created),
  );
  for (const grant of grants.slice(MAX_GRANTS_PER_OWNER)) deleteGrant(grant, 'superseded');
}

const invalidGrant = (description: string): TokenError => tokenError('invalid_grant', description);

export function exchangeCode(
  exchange: CodeExchange,
  deps: Deps,
  now = new Date(),
): TokenResponse | TokenError {
  if (!TOKEN_PATTERN.test(exchange.code)) return invalidGrant('Unknown authorization code');
  return runInRepo(() => {
    const connection = getConnection();
    const path = `${CODES_PATH}/${sha256Hex(exchange.code)}`;
    const code = connection.get<CodeData>(path);
    if (code == null) return invalidGrant('Unknown authorization code');
    if (code.grant != null) return replayed(code.grant, path);
    if (isPast(code.expires, now)) return invalidGrant('The authorization code expired');
    if (code.clientId !== exchange.clientId || code.redirectUri !== exchange.redirectUri) {
      return invalidGrant('The authorization code was issued to another client or redirect_uri');
    }
    if (exchange.resource != null && exchange.resource !== code.resource) {
      return tokenError('invalid_target', `The only resource is ${code.resource}`);
    }
    if (!verifyPkce(exchange.verifier, code.challenge, sha256Base64Url)) {
      return invalidGrant('The code_verifier does not match the code_challenge');
    }
    const owner = deps.checkOwner(code.owner);
    if ('refusal' in owner) {
      log.warning(`OAuth refused a code of ${code.owner}: the owner ${owner.refusal}`);
      return invalidGrant('The user who approved this client may no longer use it');
    }

    const id = sha256Hex(randomToken());
    connection.update<CodeData>({
      key: path,
      editor: (node) => (node.grant == null ? { ...node, grant: id } : node),
    });
    const claimed = connection.get<CodeData>(path)?.grant;
    if (claimed !== id) return replayed(claimed, path);

    const tokens = issueTokens(id, now, deps);
    const grant = connection.create<GrantData>({
      _name: id,
      _parentPath: GRANTS_PATH,
      _inheritsPermissions: true,
      owner: code.owner,
      clientId: code.clientId,
      redirectUri: code.redirectUri,
      resource: code.resource,
      scope: code.scope,
      created: now.toISOString(),
      expires: later(now, GRANT_TTL_MS),
      refresh: tokens.refresh,
      refreshExpires: earliest(tokens.refreshExpires, later(now, GRANT_TTL_MS)),
      access: tokens.access,
    });
    audit('grant', grant);
    if (connection.get<CodeData>(path)?.replayed === true) {
      deleteGrant(grant, 'code replayed');
      log.warning(
        `OAuth revoked a grant of ${code.owner} for ${code.clientId}: its code was replayed`,
      );
      return invalidGrant('The authorization code was already used');
    }
    try {
      capGrants(code.owner);
    } catch (e) {
      log.warning(`OAuth could not cap the grants of ${code.owner}: ${redactKeys(String(e))}`);
    }
    return tokens.response;
  });
}

// RFC 9700 §4.2.4: a code redeemed twice revokes what the first redemption issued. The mark
// covers a replay that arrives before that grant exists, which the first exchange checks for.
function replayed(id: string | undefined, path: string): TokenError {
  getConnection().update<CodeData>({ key: path, editor: (node) => ({ ...node, replayed: true }) });
  const grant = id == null ? undefined : getGrant(id);
  if (grant != null) {
    deleteGrant(grant, 'code replayed');
    log.warning(
      `OAuth revoked a grant of ${grant.owner} for ${grant.clientId}: its code was replayed`,
    );
  }
  return invalidGrant('The authorization code was already used');
}

export type RefreshExchange = { refreshToken: string; clientId: string; resource?: string };

export function refresh(
  exchange: RefreshExchange,
  deps: Deps,
  now = new Date(),
): TokenResponse | TokenError {
  const [id, secret, extra] = exchange.refreshToken.split('.');
  if (extra != null || secret == null || !TOKEN_PATTERN.test(secret)) {
    return invalidGrant('Unknown refresh token');
  }
  return runInRepo(() => {
    const connection = getConnection();
    const grant = getGrant(id);
    if (grant == null) return invalidGrant('Unknown refresh token');
    const digest = sha256Hex(exchange.refreshToken);
    const match = matchRefresh(grant, digest, now);
    if (match === 'raced') return invalidGrant('The refresh token was already rotated');
    if (match === 'reused') {
      deleteGrant(grant, 'refresh token reused');
      log.warning(
        `OAuth revoked a grant of ${grant.owner} for ${grant.clientId}: a rotated refresh token was reused`,
      );
      return invalidGrant('The refresh token was already used; sign in again');
    }
    if (grant.clientId !== exchange.clientId) {
      return invalidGrant('The refresh token was issued to another client');
    }
    if (exchange.resource != null && exchange.resource !== grant.resource) {
      return tokenError('invalid_target', `The only resource is ${grant.resource}`);
    }
    if (isPast(grant.expires, now) || isPast(grant.refreshExpires, now)) {
      deleteGrant(grant, 'expired');
      return invalidGrant('The grant expired; sign in again');
    }
    const owner = deps.checkOwner(grant.owner);
    if ('refusal' in owner) {
      deleteGrant(grant, `owner ${owner.refusal}`);
      log.warning(`OAuth revoked a grant of ${grant.owner}: the owner ${owner.refusal}`);
      return invalidGrant('The user who approved this client may no longer use it');
    }

    const tokens = issueTokens(id, now, deps);
    const key = grantPath(id);
    const dropped =
      grant.previousAccess == null
        ? undefined
        : connection.get<AccessData>(accessPath(grant.previousAccess));
    connection.update<GrantData>({
      key,
      editor: (node) =>
        node.refresh !== digest
          ? node
          : {
              ...node,
              lastUsed: latest(node.lastUsed, dropped?.lastUsed),
              refresh: tokens.refresh,
              refreshExpires: earliest(tokens.refreshExpires, node.expires),
              previousRefresh: digest,
              rotated: now.toISOString(),
              access: tokens.access,
              previousAccess: node.access,
            },
    });
    if (connection.get<GrantData>(key)?.refresh !== tokens.refresh) {
      connection.delete(accessPath(tokens.access));
      return invalidGrant('The refresh token was already rotated');
    }
    if (grant.previousAccess != null) connection.delete(accessPath(grant.previousAccess));
    return tokens.response;
  });
}

// Admits an access key only while its grant stands and still names it. Expired, superseded and
// orphaned access nodes are refused here and removed by the sweep.
export function resolveAccess(bearer: string, now = new Date()): AccessResolution | undefined {
  const digest = sha256Hex(bearer);
  return runInRepo(() => {
    const connection = getConnection();
    const access = connection.get<AccessData>(accessPath(digest));
    if (access == null) return undefined;
    const grant = getGrant(access.grant);
    if (grant == null || (digest !== grant.access && digest !== grant.previousAccess)) {
      return { reason: 'OAuth key of a revoked grant' };
    }
    if (isPast(access.expires, now)) {
      return {
        reason: `OAuth key of ${grant.owner} for ${grant.clientId} expired at ${access.expires}`,
      };
    }
    const end = earliest(grant.expires, grant.refreshExpires);
    if (isPast(end, now)) {
      return { reason: `OAuth grant of ${grant.owner} for ${grant.clientId} ended at ${end}` };
    }
    touch(access, grant.owner, now);
    return { owner: grant.owner, clientId: grant.clientId };
  });
}

// Best effort and at most hourly, like a personal key's `lastUsed`.
function touch(access: Node<AccessData>, owner: string, now: Date): void {
  if (access.lastUsed != null && now.getTime() - Date.parse(access.lastUsed) < TOUCH_INTERVAL_MS) {
    return;
  }
  try {
    getConnection().update<AccessData>({
      key: access._id,
      editor: (node) => ({ ...node, lastUsed: now.toISOString() }),
    });
  } catch (e) {
    log.warning(`Could not record OAuth key use for ${owner}: ${redactKeys(String(e))}`);
  }
}

// Every grant, or one owner's; newest first.
export function listGrants(owner?: string): Grant[] {
  return runInRepo(() =>
    getAll<GrantData>(childIds(GRANTS_PATH, owner))
      .map(toGrant)
      .sort((a, b) => b.created.localeCompare(a.created)),
  );
}

// With `owner`, revokes only a grant of that owner.
export function revokeGrant(id: string, owner?: string): boolean {
  return runInRepo(() => {
    const grant = getGrant(id);
    if (grant == null || (owner != null && grant.owner !== owner)) return false;
    deleteGrant(grant, 'revoked');
    return true;
  });
}
