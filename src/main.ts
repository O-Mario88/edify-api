import 'reflect-metadata';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.enableCors();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

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
  await app.listen(port);
  logger.log(`Edify API on http://localhost:${port}/api (docs: /api/docs)`);
  logger.log(
    `flags: mock=${config.get('ENABLE_MOCK_DATA')} devEndpoints=${config.get('ENABLE_DEV_ENDPOINTS')} salesforce=${config.get('ENABLE_SALESFORCE_INTEGRATION')}`,
  );
}
void bootstrap();
