import type { ApiError, ApiResponse } from '../../types/api';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

type ApiFetchOptions = {
  method?: HttpMethod;
  body?: unknown;
  params?: Record<string, string>;
  signal?: AbortSignal;
};

export function buildUrl(apiUrl: string, params?: Record<string, string>): string {
  const url = new URL(apiUrl, window.location.origin);

  if (params != null) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

export async function apiFetch<T>(apiUrl: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = 'GET', body, params, signal } = options;
  const url = buildUrl(apiUrl, params);

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (body != null) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!response.ok) {
    const error: ApiError = await response.json().catch(() => ({
      status: response.status,
      message: response.statusText,
    }));
    throw error;
  }

  const envelope: ApiResponse<T> = await response.json();
  return envelope.data;
}
