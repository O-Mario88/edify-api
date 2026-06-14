import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// Per-request provenance carried implicitly through the async call tree, so the
// (singleton) AuditService can stamp ip / user-agent / correlationId onto every
// audit row WITHOUT threading context through dozens of service call sites.
export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  get(): RequestContext | undefined {
    return storage.getStore();
  },
};

/**
 * Express middleware that opens an AsyncLocalStorage scope for the request.
 * Honors an inbound `x-correlation-id` (for cross-service tracing) or mints one,
 * and echoes it on the response so logs + the eventual error envelope share it.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ctx: RequestContext = {
    ipAddress: forwarded || req.ip || req.socket?.remoteAddress || undefined,
    userAgent: req.headers['user-agent'],
    correlationId,
  };
  res.setHeader('x-correlation-id', correlationId);
  storage.run(ctx, () => next());
}
