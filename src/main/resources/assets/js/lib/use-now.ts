import { useSyncExternalStore } from 'react';

const TICK_MS = 15_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => listeners.forEach((notify) => notify()), TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearInterval(timer);
    timer = undefined;
  };
}

// Floored to the tick, so every read within one tick returns the same value, as
// `useSyncExternalStore` requires, and all subscribers move on together.
function getNow(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getNow);
}
