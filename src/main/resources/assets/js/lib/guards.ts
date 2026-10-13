import { redirect } from '@tanstack/react-router';

import type { RouterContext } from '../router';

// Cosmetic: the admin-only APIs refuse non-admins themselves.
export function requireAdmin({ context }: { context: RouterContext }): void {
  if (!context.config.access.admin) {
    throw redirect({ to: '/mcp' });
  }
}
