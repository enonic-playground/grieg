import { vi } from 'vitest';

// Returns the model as JSON, so tests can read what a page was rendered with.
export const render = vi.fn((_view: unknown, model: Record<string, unknown>) =>
  JSON.stringify(model),
);
