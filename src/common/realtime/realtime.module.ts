import { Global, Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import { DomainEventService } from './domain-events.service';
import { RealtimeController } from './realtime.controller';

// Global so any workflow service can inject DomainEventService without wiring
// imports. Provides the SSE stream + the event seam (audit + notifications +
// realtime push).
@Global()
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService, DomainEventService],
  exports: [RealtimeService, DomainEventService],
})
export class RealtimeModule {}
