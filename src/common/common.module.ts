import { Global, Module } from '@nestjs/common';
import { ScopeService } from './scope/scope.service';
import { AuditService } from './audit/audit.service';
import { ReadinessService } from './readiness/readiness.service';

// Cross-cutting services available app-wide without re-importing.
@Global()
@Module({
  providers: [ScopeService, AuditService, ReadinessService],
  exports: [ScopeService, AuditService, ReadinessService],
})
export class CommonModule {}
