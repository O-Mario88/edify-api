import { Global, Module } from '@nestjs/common';
import { ScopeService } from './scope/scope.service';
import { AuditService } from './audit/audit.service';
import { ReadinessService } from './readiness/readiness.service';
import { AuthorizationService } from './authz/authorization.service';
import { RateLimitGuard } from './security/rate-limit';

// Cross-cutting services available app-wide without re-importing.
@Global()
@Module({
  providers: [ScopeService, AuditService, ReadinessService, AuthorizationService, RateLimitGuard],
  exports: [ScopeService, AuditService, ReadinessService, AuthorizationService, RateLimitGuard],
})
export class CommonModule {}
