import type { Request, Response } from '@enonic-types/core';

import { originOf } from '../../lib/access';
import { errorResponse } from '../../lib/api';
import { getOauthConfig } from '../../lib/config';
import { ENDPOINTS, publishesDiscovery, wellKnownDocument } from '../../lib/oauth';

export function get(req: Request): Response {
  const document = publishesDiscovery(getOauthConfig().enabled, ENDPOINTS)
    ? wellKnownDocument(req.path, originOf(req.scheme, req.host, req.port), app.name, ENDPOINTS)
    : undefined;
  if (document == null) return errorResponse(404, 'Not found', 'NOT_FOUND');
  return {
    status: 200,
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(document),
  };
}
