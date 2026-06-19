import 'reflect-metadata';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { requestContextMiddleware } from './common/context/request-context';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Open a per-request AsyncLocalStorage scope (ip/ua/correlationId) FIRST so it
  // wraps every downstream handler — the audit log stamps provenance from it.
  app.use(requestContextMiddleware);
  app.use(helmet());
  // CORS: allowlist from CORS_ORIGINS (comma-separated); permissive only outside prod.
  const origins = (config.get<string>('CORS_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : config.get('NODE_ENV') !== 'production', credentials: true });
  app.setGlobalPrefix('api');
  // whitelist:true STRIPS properties not declared on the DTO. We intentionally
  // do NOT set forbidNonWhitelisted — the frontend sends best-effort bodies and
  // an extra/renamed field must be silently dropped, NOT rejected with a 400.
  // (forbidNonWhitelisted:true was the recurring "property X should not exist"
  // 400 — e.g. weekOfMonth. Business-rule 400s thrown in services are unaffected.)
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  // Generic error envelope — no stack traces / DB errors to clients; correlationId
  // ties a user-reported failure to the full server-side log line.
  app.useGlobalFilters(new AllExceptionsFilter());

  if (config.get<string>('NODE_ENV') !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('Edify Planning & Monitoring API')
      .setDescription('School Directory is the source of truth. Salesforce-ready, not yet integrated.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }

  const port = config.get<number>('PORT') ?? 4000;
  // Bind '::' (dual-stack IPv6) so the edify-web bridge can reach us over the
  // platform's PRIVATE network — Railway's internal DNS (edify-api.railway.internal)
  // and Fly's (.internal) both resolve to IPv6. '::' also accepts IPv4 (incl. local
  // 127.0.0.1) via dual-stack, so dev/public traffic is unaffected. A bare
  // listen(port) usually picks '::' anyway, but '0.0.0.0' would be IPv4-only and
  // silently unreachable on the internal network — pin it.
  await app.listen(port, '::');
  logger.log(`Edify API on http://localhost:${port}/api (docs: /api/docs)`);
  logger.log(
    `flags: mock=${config.get('ENABLE_MOCK_DATA')} devEndpoints=${config.get('ENABLE_DEV_ENDPOINTS')} salesforce=${config.get('ENABLE_SALESFORCE_INTEGRATION')}`,
  );
}
void bootstrap();
