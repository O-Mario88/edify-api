import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SecurityHealthService } from './security.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';

@ApiTags('security')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('security')
export class SecurityController {
  constructor(private readonly security: SecurityHealthService) {}

  // The security & data-protection dashboard. SYSTEM_ADMIN only (Admin role) —
  // never exposed to normal users.
  @Get('health')
  @RequirePermissions(PERMISSIONS.SYSTEM_ADMIN)
  health() {
    return this.security.summary();
  }
}
