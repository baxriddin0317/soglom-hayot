'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { useApp } from './store';
import { getWebApp } from './telegram';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const initData = getWebApp()?.initData ?? '';
  let res: Response;
  try {
    res = await fetch(`/api/app/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `tma ${initData}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiRequestError(t(useApp.getState().lang, 'common.network'), 0);
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    const fallback = t(useApp.getState().lang, res.status === 401 ? 'err.unauthorized' : 'common.error');
    throw new ApiRequestError(res.status === 401 ? fallback : data.error || fallback, res.status, data.code);
  }
  return data as T;
}

// Oxirgi javoblar xotirada saqlanadi — tablar orasida o'tganda ekran bo'sh turmaydi,
// orqada yangi ma'lumot kelguncha eskisi ko'rsatiladi.
const cache = new Map<string, unknown>();

export function useApi<T>(path: string, { pollMs }: { pollMs?: number } = {}) {
  const [entry, setEntry] = useState<{ path: string; data?: T; error?: ApiRequestError }>({ path });
  const pathRef = useRef(path);

  const reload = useCallback(async () => {
    const requested = path;
    try {
      const fresh = await api<T>(requested);
      cache.set(requested, fresh);
      if (pathRef.current === requested) setEntry({ path: requested, data: fresh });
    } catch (err) {
      if (pathRef.current !== requested) return;
      const error = err instanceof ApiRequestError ? err : new ApiRequestError(String(err), 0);
      setEntry((prev) => ({ path: requested, data: prev.path === requested ? prev.data : undefined, error }));
    }
  }, [path]);

  useEffect(() => {
    pathRef.current = path;
    // reload state'ni faqat so'rov javobidan keyin (asinxron) o'zgartiradi — bu tashqi manba bilan sinxronlash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [path, reload]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, reload]);

  const own = entry.path === path;
  return {
    data: (own && entry.data !== undefined ? entry.data : cache.get(path)) as T | undefined,
    error: own ? (entry.error ?? null) : null,
    reload,
  };
}

// Ma'lumotni oldindan yuklab keshga qo'yadi — keyingi ekran eskirgan holatni ko'rsatmasdan ochiladi.
export async function prefetch(path: string): Promise<void> {
  cache.set(path, await api(path));
}

export function invalidate(...paths: string[]): void {
  for (const path of paths) cache.delete(path);
}

// Amal (masalan doza belgilash) dan keyin barcha ekranlar yangi ma'lumotni yuklaydi.
export function invalidateAll(): void {
  cache.clear();
}
