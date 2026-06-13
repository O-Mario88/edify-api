import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClustersService } from './clusters.service';
import { AssignClusterDto, CreateClusterDto, CreateClusterFromSchoolDto } from './dto/cluster.dto';
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

  @Get('sub-counties-without-clusters')
  @RequirePermissions(PERMISSIONS.CLUSTER_VIEW)
  subCountiesWithoutClusters(@CurrentUser() user: AuthUser) {
    return this.clusters.subCountiesWithoutClusters(user);
  }

  // Per-cluster meeting-slot planning status (SIT + 1st/2nd/3rd meetings),
  // derived from real cluster activities. Powers the live cluster gap board.
  @Get('planning')
  @RequirePermissions(PERMISSIONS.CLUSTER_VIEW)
  planning(@CurrentUser() user: AuthUser) {
    return this.clusters.clusterPlanning(user);
  }

  @Get(':id/schools')
  @RequirePermissions(PERMISSIONS.CLUSTER_VIEW)
  clusterSchools(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.clusters.clusterSchools(id, user);
  }

  @Get('recommendations/:schoolId')
  @RequirePermissions(PERMISSIONS.CLUSTER_VIEW)
  recommendations(@Param('schoolId') schoolId: string, @CurrentUser() user: AuthUser) {
    return this.clusters.recommendations(schoolId, user);
  }

  // The eligible-cluster list for a school's geography (§5 assignment drawer).
  // Only clusters covering the school's sub-county are returned as eligible.
  @Get('eligible-for-school/:schoolId')
  @RequirePermissions(PERMISSIONS.CLUSTER_VIEW)
  eligibleForSchool(@Param('schoolId') schoolId: string, @CurrentUser() user: AuthUser) {
    return this.clusters.eligibleForSchool(schoolId, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CLUSTER_ASSIGN)
  create(@Body() dto: CreateClusterDto, @CurrentUser() user: AuthUser) {
    return this.clusters.create(dto, user);
  }

  @Post('from-school')
  @RequirePermissions(PERMISSIONS.CLUSTER_ASSIGN)
  createFromSchool(@Body() dto: CreateClusterFromSchoolDto, @CurrentUser() user: AuthUser) {
    return this.clusters.createFromSchool(dto, user);
  }

  @Post('assign')
  @RequirePermissions(PERMISSIONS.CLUSTER_ASSIGN)
  assign(@Body() dto: AssignClusterDto, @CurrentUser() user: AuthUser) {
    return this.clusters.assignSchool(dto.schoolId, dto.clusterId, dto.reason, user);
  }
}
