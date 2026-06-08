import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { TargetsService } from './targets.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

const TARGET_TYPES = [
  'SCHOOL_REACH', 'STAFF_DIRECT_SUPPORT', 'PARTNER_SUPPORT', 'TRAINING', 'SSA', 'SCHOOL_VISIT',
  'MSCS', 'EXAM_RESULTS', 'CORE_PACKAGE', 'PROJECT_SUPPORT', 'IA_VERIFICATION', 'ACCOUNTABILITY',
];
const SCOPE_TYPES = ['country', 'region', 'district', 'cluster', 'staff', 'pl_team', 'partner', 'project', 'school_type'];

class TimePeriodQueryDto {
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsString() staffId?: string;
}

class ListTargetsQueryDto {
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsIn(TARGET_TYPES) targetType?: string;
  @IsOptional() @IsIn(SCOPE_TYPES) scopeType?: string;
  @IsOptional() @IsString() scopeId?: string;
}

class SetTargetDto {
  @IsOptional() @IsString() fy?: string;
  @IsIn(TARGET_TYPES) targetType!: string;
  @IsIn(SCOPE_TYPES) scopeType!: string;
  @IsOptional() @IsString() scopeId?: string;
  @IsOptional() @IsNumber() targetValue?: number;
  @IsOptional() @IsIn(['count', 'percentage']) targetUnit?: 'count' | 'percentage';
  @IsOptional() @IsNumber() targetPercentage?: number;
  @IsOptional() @IsObject() quarterDistribution?: Record<string, number>;
  @IsOptional() @IsString() effectiveFrom?: string;
  @IsOptional() @IsString() effectiveTo?: string;
  @IsOptional() @IsString() notes?: string;
}

@ApiTags('targets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('targets')
export class TargetsController {
  constructor(private readonly targets: TargetsService) {}

  // Multi-category Targets by Time Period — reach/training/SSA/visit/MSCS/exam,
  // cumulative Q1 → Mid-Year → EoY.
  @Get('time-period')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  timePeriod(@Query() q: TimePeriodQueryDto, @CurrentUser() user: AuthUser) {
    return this.targets.timePeriod(user, q);
  }

  // Annual by-category rollup (school reach, training, SSA, visit, MSCS, exam).
  @Get('summary')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  summary(@Query() q: TimePeriodQueryDto, @CurrentUser() user: AuthUser) {
    return this.targets.summary(user, q);
  }

  // The active CD/IA target settings (what's been set vs defaulted).
  @Get()
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  list(@Query() q: ListTargetsQueryDto, @CurrentUser() user: AuthUser) {
    return this.targets.listTargets(user, q);
  }

  // CD or IA sets a target. The service enforces the role gate.
  @Post()
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  set(@Body() dto: SetTargetDto, @CurrentUser() user: AuthUser) {
    return this.targets.setTarget(user, dto);
  }
}
