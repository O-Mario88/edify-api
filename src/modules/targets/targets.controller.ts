import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { TargetsService } from './targets.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

class TimePeriodQueryDto {
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsString() staffId?: string;
}

@ApiTags('targets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('targets')
export class TargetsController {
  constructor(private readonly targets: TargetsService) {}

  // Targets by Time Period — staff/partner/total, cumulative Q1 → Mid-Year → EoY.
  @Get('time-period')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  timePeriod(@Query() q: TimePeriodQueryDto, @CurrentUser() user: AuthUser) {
    return this.targets.timePeriod(user, q);
  }
}
