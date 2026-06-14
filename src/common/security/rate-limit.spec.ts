import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { RateLimitGuard, type RateLimitConfig } from './rate-limit';

function ctxFor(ip: string): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ headers: {}, ip, socket: { remoteAddress: ip } }) }),
  } as unknown as ExecutionContext;
}

function guardWith(cfg: RateLimitConfig | undefined) {
  const reflector = { get: () => cfg } as unknown as Reflector;
  return new RateLimitGuard(reflector);
}

describe('RateLimitGuard', () => {
  it('allows up to the limit, then throws 429', () => {
    const guard = guardWith({ name: 'login', limit: 3, windowMs: 60_000 });
    const ctx = ctxFor('1.1.1.1');
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrow(HttpException);
  });

  it('is per-IP (a different client is independent)', () => {
    const guard = guardWith({ name: 'login', limit: 1, windowMs: 60_000 });
    expect(guard.canActivate(ctxFor('2.2.2.2'))).toBe(true);
    expect(() => guard.canActivate(ctxFor('2.2.2.2'))).toThrow();
    // Fresh IP — not throttled by the other client's hits.
    expect(guard.canActivate(ctxFor('3.3.3.3'))).toBe(true);
  });

  it('no @RateLimit config → not limited', () => {
    const guard = guardWith(undefined);
    const ctx = ctxFor('4.4.4.4');
    for (let i = 0; i < 50; i++) expect(guard.canActivate(ctx)).toBe(true);
  });
});
