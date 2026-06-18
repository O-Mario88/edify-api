import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HrService } from './hr.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('hr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr')
export class HrController {
  constructor(private readonly hr: HrService) {}

  // Staff directory carries PII (names + emails). Gate it: only roles with the
  // staff-performance view permission (HR, CD, RVP, PL, Admin) may read it —
  // Accountant / CCEO / IA / Partner are blocked at the guard. The service
  // further scopes WHICH staff are returned and strips emails for non-managers.
  @Get('roster')
  @RequirePermissions(PERMISSIONS.STAFF_PERFORMANCE_VIEW)
  roster(@CurrentUser() user: AuthUser) {
    return this.hr.roster(user);
  }

  @Get('leave')
  leave(@CurrentUser() user: AuthUser) {
    return this.hr.listLeave(user);
  }

  // Approved leave shaped for the calendar + planning-availability engine.
  @Get('leave/calendar')
  leaveCalendar(@Query('from') from: string, @Query('to') to: string, @CurrentUser() user: AuthUser) {
    return this.hr.approvedLeaveCalendar(user, from, to);
  }

  @Post('leave')
  request(@Body() body: { type?: string; startDate?: string; endDate?: string; days?: number; reason?: string }, @CurrentUser() user: AuthUser) {
    return this.hr.requestLeave(user, body ?? {});
  }

  @Post('leave/:id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.hr.reviewLeave(user, id, 'approve');
  }

  @Post('leave/:id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.hr.reviewLeave(user, id, 'reject');
  }
}
