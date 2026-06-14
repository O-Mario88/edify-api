import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestContext } from '../context/request-context';

// Global exception filter (spec §24). Clients never see stack traces, DB errors,
// or internal paths. Business 4xx keep their (intentional, safe) messages — e.g.
// "Cannot clear payment — activity is not IA-verified." — while 5xx return a
// generic message. Every response carries the correlationId so a user-reported
// issue maps to the full server-side log line.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = requestContext.get()?.correlationId ?? (res.getHeader('x-correlation-id') as string | undefined) ?? 'unknown';

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let payload: Record<string, unknown>;
    if (isHttp) {
      const r = exception.getResponse();
      payload = typeof r === 'string' ? { message: r } : (r as Record<string, unknown>);
    } else {
      // Unexpected/unknown error — never leak internals.
      payload = { message: 'We could not complete that action. Please try again.' };
    }

    // Full detail server-side only (5xx at error level, 4xx at debug).
    const err = exception as Error;
    const line = `[${correlationId}] ${req.method} ${req.originalUrl} -> ${status} : ${err?.message ?? 'unknown'}`;
    if (status >= 500) this.logger.error(line, err?.stack);
    else this.logger.debug(line);

    res.status(status).json({ statusCode: status, correlationId, ...payload });
  }
}
