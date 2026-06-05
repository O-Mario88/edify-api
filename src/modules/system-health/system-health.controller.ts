import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SystemHealthService } from './system-health.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';

@ApiTags('system-health')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('system-health')
export class SystemHealthController {
  constructor(private readonly health: SystemHealthService) {}

  // Org-wide health counts — restricted to country oversight (CD/IA/Admin).
  @Get()
  @RequirePermissions(PERMISSIONS.PLANNING_RECALC)
  report() {
    return this.health.report();
  }
}
