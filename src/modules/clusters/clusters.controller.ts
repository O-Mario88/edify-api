import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClustersService } from './clusters.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('clusters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('clusters')
export class ClustersController {
  constructor(private readonly clusters: ClustersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CLUSTER_VIEW)
  list(@CurrentUser() user: AuthUser) {
    return this.clusters.list(user);
  }

  @Get('recommendations/:schoolId')
  @RequirePermissions(PERMISSIONS.CLUSTER_VIEW)
  recommendations(@Param('schoolId') schoolId: string, @CurrentUser() user: AuthUser) {
    return this.clusters.recommendations(schoolId, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CLUSTER_ASSIGN)
  create(@Body() body: { name: string; regionId: string; districtId: string }, @CurrentUser() user: AuthUser) {
    return this.clusters.create(body.name, body.regionId, body.districtId, user);
  }

  @Post('assign')
  @RequirePermissions(PERMISSIONS.CLUSTER_ASSIGN)
  assign(@Body() body: { schoolId: string; clusterId: string }, @CurrentUser() user: AuthUser) {
    return this.clusters.assignSchool(body.schoolId, body.clusterId, user);
  }
}
