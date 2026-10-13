import { queryOptions } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch } from './client';

export type KeyInfo = {
  display: string;
  created: string;
  expires: string;
  lastUsed?: string;
};

export type GeneratedKey = KeyInfo & { key: string };

export type OwnedKeyInfo = KeyInfo & { owner: string };

type KeyList = {
  keys: OwnedKeyInfo[];
};

export const KEYS_QUERY_KEY = ['keys'] as const;
export const OWN_KEY_QUERY_KEY = [...KEYS_QUERY_KEY, 'own'] as const;
export const ALL_KEYS_QUERY_KEY = [...KEYS_QUERY_KEY, 'all'] as const;

export function fetchOwnKey(): Promise<KeyInfo | null> {
  return apiFetch<KeyInfo | null>(getConfig().apiUris.keys);
}

// The API refuses a POST that is not JSON, and `apiFetch` sets the content type only with a body.
export function generateKey(): Promise<GeneratedKey> {
  return apiFetch<GeneratedKey>(getConfig().apiUris.keys, { method: 'POST', body: {} });
}

export function deleteOwnKey(): Promise<unknown> {
  return apiFetch(getConfig().apiUris.keys, { method: 'DELETE' });
}

export function fetchAllKeys(): Promise<OwnedKeyInfo[]> {
  return apiFetch<KeyList>(getConfig().apiUris.keys, { params: { all: 'true' } }).then(
    (result) => result.keys,
  );
}

export function revokeKey(owner: string): Promise<unknown> {
  return apiFetch(getConfig().apiUris.keys, { method: 'DELETE', params: { owner } });
}

export function ownKeyQueryOptions() {
  return queryOptions({
    queryKey: OWN_KEY_QUERY_KEY,
    queryFn: fetchOwnKey,
  });
}

export function allKeysQueryOptions() {
  return queryOptions({
    queryKey: ALL_KEYS_QUERY_KEY,
    queryFn: fetchAllKeys,
  });
}
