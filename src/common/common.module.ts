import { Global, Module } from '@nestjs/common';
import { ScopeService } from './scope/scope.service';
import { AuditService } from './audit/audit.service';

// Cross-cutting services available app-wide without re-importing.
@Global()
@Module({
  providers: [ScopeService, AuditService],
  exports: [ScopeService, AuditService],
})
export class CommonModule {}
