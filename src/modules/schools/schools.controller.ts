import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SchoolsService } from './schools.service';
import { ClustersService } from '../clusters/clusters.service';
import { SchoolClusterBodyDto } from '../clusters/dto/cluster.dto';
import { CreateSchoolDto } from './dto/create-school.dto';
import { BulkUploadDto } from './dto/bulk-upload.dto';
import { QuerySchoolsDto } from './dto/query-schools.dto';
import { ResolveDuplicateDto } from './dto/resolve-duplicate.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('schools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schools')
export class SchoolsController {
  constructor(
    private readonly schools: SchoolsService,
    private readonly clusters: ClustersService,
  ) {}

  // RESTful cluster assignment (§11): POST /schools/:schoolId/cluster
  @Post(':schoolId/cluster')
  @RequirePermissions(PERMISSIONS.CLUSTER_ASSIGN)
  assignCluster(
    @Param('schoolId') schoolId: string,
    @Body() body: SchoolClusterBodyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.clusters.assignSchool(schoolId, body.clusterId, body.reason, user);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.SCHOOL_VIEW)
  list(@Query() query: QuerySchoolsDto, @CurrentUser() user: AuthUser) {
    return this.schools.list(query, user);
  }

  @Get(':schoolId')
  @RequirePermissions(PERMISSIONS.SCHOOL_VIEW)
  getOne(@Param('schoolId') schoolId: string, @CurrentUser() user: AuthUser) {
    return this.schools.getOne(schoolId, user);
  }

  // Scope-aware "Plan Action" resolver for ONE school (spec §10).
  @Get(':schoolId/next-actions')
  @RequirePermissions(PERMISSIONS.SCHOOL_VIEW)
  nextActions(@Param('schoolId') schoolId: string, @Query('fy') fy: string | undefined, @CurrentUser() user: AuthUser) {
    return this.schools.nextActions(schoolId, user, fy);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SCHOOL_UPLOAD)
  create(@Body() dto: CreateSchoolDto, @CurrentUser() user: AuthUser) {
    return this.schools.createOne(dto, user);
  }

  @Post('bulk')
  @RequirePermissions(PERMISSIONS.SCHOOL_UPLOAD)
  bulk(@Body() dto: BulkUploadDto, @CurrentUser() user: AuthUser) {
    return this.schools.bulkUpload(dto, user);
  }

  @Post(':id/resolve-duplicate')
  @RequirePermissions(PERMISSIONS.SCHOOL_RESOLVE_DUPLICATE)
  resolveDuplicate(@Param('id') id: string, @Body() dto: ResolveDuplicateDto, @CurrentUser() user: AuthUser) {
    return this.schools.resolveDuplicate(id, dto.resolution, user);
  }
}
