import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SchoolsService } from './schools.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { BulkUploadDto } from './dto/bulk-upload.dto';
import { QuerySchoolsDto } from './dto/query-schools.dto';
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
  constructor(private readonly schools: SchoolsService) {}

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
  resolveDuplicate(
    @Param('id') id: string,
    @Body('resolution') resolution: 'not_duplicate' | 'merged' | 'archived',
    @CurrentUser() user: AuthUser,
  ) {
    return this.schools.resolveDuplicate(id, resolution, user);
  }
}
