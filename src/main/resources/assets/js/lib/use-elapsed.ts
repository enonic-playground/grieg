import { useEffect, useState } from 'react';

const TICK_MS = 1000;

export function useElapsed(since: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return Math.max(0, now - since);
}
