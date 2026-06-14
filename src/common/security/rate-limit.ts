import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

// Lightweight, dependency-free rate limiter (spec §25). A sliding window per
// (route-name + client IP), held in memory. Adequate for brute-force protection
// on auth + sensitive endpoints on a single instance; for multi-instance
// production, back this with Redis (see incident-response-plan / deployment doc).

export interface RateLimitConfig {
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_KEY = 'edify:rate-limit';
export const RateLimit = (config: RateLimitConfig) => SetMetadata(RATE_LIMIT_KEY, config);

@Injectable()
export class RateLimitGuard implements CanActivate {
  // key -> request timestamps within the current window
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const cfg = this.reflector.get<RateLimitConfig>(RATE_LIMIT_KEY, ctx.getHandler());
    if (!cfg) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${cfg.name}:${ip}`;
    const now = Date.now();

    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < cfg.windowMs);
    if (recent.length >= cfg.limit) {
      const retryMs = cfg.windowMs - (now - recent[0]);
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests — please slow down and try again shortly.', retryAfterSeconds: Math.ceil(retryMs / 1000) },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(key, recent);

    // Opportunistic cleanup so the map doesn't grow unbounded.
    if (this.hits.size > 5000) {
      for (const [k, ts] of this.hits) {
        if (ts.every((t) => now - t >= cfg.windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }
}
