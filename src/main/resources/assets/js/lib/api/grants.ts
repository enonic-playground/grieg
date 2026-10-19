import { queryOptions } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch } from './client';

export type GrantInfo = {
  id: string;
  // Named from the grant's redirect URI: Claude, ChatGPT, or the callback's host.
  client: string;
  clientId: string;
  created: string;
  expires: string;
  lastUsed?: string;
  // Only in the admin list of every grant.
  owner?: string;
};

export type GrantScope = 'own' | 'all';

type GrantList = {
  grants: GrantInfo[];
};

export const GRANTS_QUERY_KEY = ['grants'] as const;

export function fetchGrants(scope: GrantScope): Promise<GrantInfo[]> {
  const params: Record<string, string> = scope === 'all' ? { all: 'true' } : {};
  return apiFetch<GrantList>(getConfig().apiUris.grants, { params }).then(
    (result) => result.grants,
  );
}

// With the owner, from the admin list, revokes through the admin path.
export function revokeGrant({ id, owner }: Pick<GrantInfo, 'id' | 'owner'>): Promise<unknown> {
  const params: Record<string, string> = owner == null ? { id } : { id, owner };
  return apiFetch(getConfig().apiUris.grants, { method: 'DELETE', params });
}

export function grantsQueryOptions(scope: GrantScope) {
  return queryOptions({
    queryKey: [...GRANTS_QUERY_KEY, scope],
    queryFn: () => fetchGrants(scope),
  });
}
