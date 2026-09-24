import { vi } from 'vitest';

export const run = vi.fn((_context: unknown, callback: () => unknown) => callback());
export const get = vi.fn();
