import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SpecialProjectsService } from './special-projects.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('special-projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.ANALYTICS_VIEW)
@Controller('special-projects')
export class SpecialProjectsController {
  constructor(private readonly projects: SpecialProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.projects.getOne(id, user);
  }

  // Assign a School-Directory school to a project. The ONLY write path — gated
  // on ACTIVITY_ASSIGN (the planning-capable field roles: CCEO / PL / CD /
  // ProjectCoordinator / Admin — not IA), matching who may assign from the
  // Directory. Validated against the Directory so no orphan assignments exist.
  @Post(':id/schools')
  @RequirePermissions(PERMISSIONS.ACTIVITY_ASSIGN)
  assignSchool(@Param('id') id: string, @Body() body: { schoolId?: string }, @CurrentUser() user: AuthUser) {
    return this.projects.assignSchool(user, id, body?.schoolId ?? '');
  }

  @Delete(':id/schools/:schoolId')
  @RequirePermissions(PERMISSIONS.ACTIVITY_ASSIGN)
  removeSchool(@Param('id') id: string, @Param('schoolId') schoolId: string, @CurrentUser() user: AuthUser) {
    return this.projects.removeSchool(user, id, schoolId);
  }
}
