import { createRole, getMemberships, getPrincipal } from '/lib/xp/auth';

import type { KeyResolution } from './access';
import type { Node } from '/lib/xp/node';

import { randomToken, sha256Hex } from './key-crypto';
import { ensureAdminFolder, getConnection, runInRepo } from './repo';

const ADMIN_ROLE = 'role:system.admin';

// Membership in this role is what entitles a user to hold an MCP key.
export const MCP_ROLE_NAME = 'com.enonic.app.grieg.mcp';
export const MCP_ROLE = `role:${MCP_ROLE_NAME}`;

export const KEY_PREFIX = 'grieg_';
export const KEYS_PATH = '/mcp/keys';

const KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const MAX_KEYS = 10_000;
// 32 random bytes are 43 base64url characters without padding.
const KEY_PATTERN = /^grieg_[\w-]{43}$/;
const OWNER_PATTERN = /^user:[^:]+:[^:]+$/;

type UserKey = `user:${string}:${string}`;

function isUserKey(owner: string): owner is UserKey {
  return OWNER_PATTERN.test(owner);
}

export type McpKey = {
  id: string;
  owner: string;
  display: string;
  created: string;
  expires: string;
  lastUsed?: string;
};

export type GeneratedKey = { key: string; record: McpKey };

// The node is named by the key's SHA-256 digest and is never changed after creation,
// except for `lastUsed`.
type KeyData = {
  owner: string;
  display: string;
  created: string;
  expires: string;
  lastUsed?: string;
};

function toKey(node: Node<KeyData>): McpKey {
  return {
    id: node._id,
    owner: node.owner,
    display: node.display,
    created: node.created,
    expires: node.expires,
    lastUsed: node.lastUsed,
  };
}

function ensureFolders(): void {
  ensureAdminFolder('/', 'mcp');
  ensureAdminFolder('/mcp', 'keys');
}

function ensureRole(): void {
  if (getPrincipal(MCP_ROLE) != null) return;
  try {
    createRole({
      name: MCP_ROLE_NAME,
      displayName: 'Grieg MCP',
      description: 'May hold a personal Grieg MCP key.',
    });
    log.info(`Created role ${MCP_ROLE}`);
  } catch (e) {
    if (getPrincipal(MCP_ROLE) == null) throw e;
  }
}

export function initKeyStore(): void {
  runInRepo(() => {
    ensureFolders();
    ensureRole();
  });
}

// Refreshes first, so a write whose own refresh never ran is still seen, and a failed
// refresh stops the caller before it changes anything.
function queryIds(owner?: string): string[] {
  const connection = getConnection();
  connection.refresh('SEARCH');
  const parent = { term: { field: '_parentPath', value: KEYS_PATH } };
  const result = connection.query({
    count: MAX_KEYS,
    query:
      owner == null
        ? parent
        : { boolean: { must: [parent, { term: { field: 'owner', value: owner } }] } },
    sort: 'owner ASC',
  });
  // The search engine's result window caps paging at the same size.
  if (result.total > result.hits.length) {
    log.warning(`MCP key query returned ${result.hits.length} of ${result.total} keys`);
  }
  return result.hits.map((hit) => hit.id);
}

function getKeys(ids: string[]): McpKey[] {
  if (ids.length === 0) return [];
  const nodes = getConnection().get<KeyData>(ids);
  if (nodes == null) return [];
  return (Array.isArray(nodes) ? nodes : [nodes]).map(toKey);
}

function newest(keys: McpKey[]): McpKey | undefined {
  return keys.reduce<McpKey | undefined>((best, key) => {
    if (best == null || key.created > best.created) return key;
    return key.created === best.created && key.id > best.id ? key : best;
  }, undefined);
}

// Returns the plaintext key; only its digest is stored, so it cannot be shown again.
// lib-node has no lock, so two overlapping calls for one owner can each keep their key;
// the next generate or deleteByOwner removes both.
export function generate(owner: string, now = new Date()): GeneratedKey {
  if (!isUserKey(owner)) {
    throw new Error(`MCP keys belong to users; \`${owner}\` is not a user key`);
  }
  const random = randomToken();
  const key = `${KEY_PREFIX}${random}`;
  return runInRepo(() => {
    ensureFolders();
    const connection = getConnection();
    const previous = queryIds(owner);
    const node = connection.create<KeyData>({
      _name: sha256Hex(key),
      _parentPath: KEYS_PATH,
      _inheritsPermissions: true,
      owner,
      display: `${KEY_PREFIX}${random.slice(0, 4)}…${random.slice(-4)}`,
      created: now.toISOString(),
      expires: new Date(now.getTime() + KEY_TTL_MS).toISOString(),
    });
    if (previous.length > 0) {
      try {
        connection.delete(previous);
      } catch (e) {
        // The old key still works, so the rotation failed: drop the new key and say so.
        connection.delete(node._id);
        throw e;
      }
    }
    return { key, record: toKey(node) };
  });
}

export function resolve(key: string): McpKey | undefined {
  if (!KEY_PATTERN.test(key)) return undefined;
  const path = `${KEYS_PATH}/${sha256Hex(key)}`;
  return runInRepo(() => {
    const node = getConnection().get<KeyData>(path);
    return node == null ? undefined : toKey(node);
  });
}

export function findByOwner(owner: string): McpKey | undefined {
  return runInRepo(() => newest(getKeys(queryIds(owner))));
}

export function list(): McpKey[] {
  return runInRepo(() => getKeys(queryIds()));
}

export function deleteByOwner(owner: string): boolean {
  return runInRepo(() => {
    const connection = getConnection();
    const ids = queryIds(owner);
    if (ids.length === 0) return false;
    connection.delete(ids);
    return true;
  });
}

export function isExpired(key: McpKey, now = new Date()): boolean {
  return !(Date.parse(key.expires) > now.getTime());
}

// Best effort: records use at most hourly, and never fails the caller.
export function touch(key: McpKey, now = new Date()): void {
  if (key.lastUsed != null && now.getTime() - Date.parse(key.lastUsed) < TOUCH_INTERVAL_MS) {
    return;
  }
  try {
    runInRepo(() =>
      getConnection().update<KeyData>({
        key: key.id,
        editor: (node) => ({ ...node, lastUsed: now.toISOString() }),
      }),
    );
  } catch (e) {
    log.warning(`Could not record MCP key use for ${key.owner}: ${String(e)}`);
  }
}

function rolesOf(user: UserKey): Set<string> {
  return new Set(getMemberships(user, true).map((principal) => principal.key));
}

export function isAdmin(user: string): boolean {
  return isUserKey(user) && runInRepo(() => rolesOf(user).has(ADMIN_ROLE));
}

// Checked on every request, so removing the owner from the role or disabling them stops the
// key at once rather than at expiry.
function checkOwner(owner: string): { refusal: string } | { admin: boolean } {
  if (!isUserKey(owner)) return { refusal: 'is not a user' };
  return runInRepo(() => {
    const user = getPrincipal(owner);
    if (user == null) return { refusal: 'no longer exists' };
    if (user.disabled === true) return { refusal: 'is disabled' };
    const roles = rolesOf(owner);
    if (!roles.has(MCP_ROLE)) return { refusal: `does not hold ${MCP_ROLE}` };
    return { admin: roles.has(ADMIN_ROLE) };
  });
}

// Reasons go to the log, so they never carry the key or its digest.
export function authenticate(bearer: string, now = new Date()): KeyResolution {
  const key = resolve(bearer);
  if (key == null) return { reason: 'unknown MCP key' };
  if (isExpired(key, now)) return { reason: `MCP key of ${key.owner} expired at ${key.expires}` };

  const owner = checkOwner(key.owner);
  if ('refusal' in owner) return { reason: `owner ${key.owner} of an MCP key ${owner.refusal}` };

  touch(key, now);
  const [, idProvider, login] = key.owner.split(':');
  return { login, idProvider, admin: owner.admin };
}
