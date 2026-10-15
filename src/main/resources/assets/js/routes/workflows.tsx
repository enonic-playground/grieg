import { createFileRoute } from '@tanstack/react-router';

import { requireAdmin } from '../lib/guards';

// Layout for the list and the workflow pages: no component, so the child renders in its place.
export const Route = createFileRoute('/workflows')({
  beforeLoad: requireAdmin,
});
