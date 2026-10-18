import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { GeneratedKey, KeyInfo } from '../../lib/api/keys';

import {
  ALL_KEYS_QUERY_KEY,
  deleteOwnKey,
  generateKey,
  KEYS_QUERY_KEY,
  OWN_KEY_QUERY_KEY,
  ownKeyQueryOptions,
} from '../../lib/api/keys';
import { getExpiry } from '../../lib/expiry';

export const POLL_INTERVAL_MS = 3000;
export const POLL_WINDOW_MS = 5 * 60 * 1000;

// The key generated on this page, by its `created`; open for POLL_WINDOW_MS after that.
type Watch = { created: string; since: number; open: boolean };

export type Connection =
  | { state: 'error' }
  | { state: 'noKey' }
  | { state: 'waiting' }
  | { state: 'unused' }
  | { state: 'connected' | 'lastUsed'; at: string };

export function connectionOf(info: KeyInfo | null, watch: Watch | null): Connection {
  if (info == null || getExpiry(info.expires).expired) return { state: 'noKey' };
  // A key regenerated elsewhere is not the one this page is watching.
  const watched = watch?.created === info.created ? watch : null;
  if (info.lastUsed != null) {
    return { state: watched == null ? 'lastUsed' : 'connected', at: info.lastUsed };
  }
  return { state: watched?.open === true ? 'waiting' : 'unused' };
}

export function pollInterval(connection: Connection): number | false {
  return connection.state === 'waiting' ? POLL_INTERVAL_MS : false;
}

export function isConnected(connection: Connection | undefined): boolean {
  return connection?.state === 'connected' || connection?.state === 'lastUsed';
}

// The plaintext shows only while it still matches the stored key, so a key regenerated or
// revoked elsewhere hides it.
function revealedKey(
  generated: GeneratedKey | undefined,
  info: KeyInfo | null | undefined,
): string | undefined {
  if (generated == null || info == null) return undefined;
  return info.created === generated.created && info.display === generated.display
    ? generated.key
    : undefined;
}

function connectionFor(
  query: { isPending: boolean; data: KeyInfo | null | undefined },
  watch: Watch | null,
): Connection | undefined {
  if (query.isPending) return undefined;
  return query.data === undefined ? { state: 'error' } : connectionOf(query.data, watch);
}

export function useOwnKey() {
  const queryClient = useQueryClient();
  const [watch, setWatch] = useState<Watch | null>(null);
  // While a mutation runs, polls pause and in-flight fetches are cancelled: a late answer would
  // put the replaced key back into the cache.
  const mutating = useIsMutating({ mutationKey: OWN_KEY_QUERY_KEY }) > 0;

  const query = useQuery({
    ...ownKeyQueryOptions(),
    refetchInterval: ({ state: { data } }) =>
      mutating || data === undefined ? false : pollInterval(connectionOf(data, watch)),
  });

  useEffect(() => {
    if (watch?.open !== true) return;
    const timer = setTimeout(
      () => setWatch({ ...watch, open: false }),
      watch.since + POLL_WINDOW_MS - Date.now(),
    );
    return () => clearTimeout(timer);
  }, [watch]);

  const cancelOwnKeyFetch = (): Promise<void> =>
    queryClient.cancelQueries({ queryKey: OWN_KEY_QUERY_KEY });

  // gcTime 0 drops the plaintext from the mutation cache as soon as the page unmounts.
  const generate = useMutation({
    mutationKey: OWN_KEY_QUERY_KEY,
    mutationFn: generateKey,
    gcTime: 0,
    onMutate: cancelOwnKeyFetch,
    onSuccess: ({ key: _key, ...info }) => {
      queryClient.setQueryData(OWN_KEY_QUERY_KEY, info);
      setWatch({ created: info.created, since: Date.now(), open: true });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ALL_KEYS_QUERY_KEY }),
  });

  // Settles by refetching, so a key already gone elsewhere (404) leaves the view too.
  const remove = useMutation({
    mutationKey: OWN_KEY_QUERY_KEY,
    mutationFn: deleteOwnKey,
    onMutate: cancelOwnKeyFetch,
    onSuccess: () => {
      queryClient.setQueryData(OWN_KEY_QUERY_KEY, null);
      setWatch(null);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY }),
  });

  return {
    query,
    generate,
    remove,
    revealed: revealedKey(generate.data, query.data),
    connection: connectionFor(query, watch),
  };
}

export type OwnKey = ReturnType<typeof useOwnKey>;
