import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FundRequestsService } from './fund-requests.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('fund-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('fund-requests')
export class FundRequestsController {
  constructor(private readonly fundRequests: FundRequestsService) {}

  // Submit a fund request for a period — the amount is computed from the
  // schedule (never typed) and blocked while any activity is missing a cost.
  @Post()
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  submit(@Body() body: { period?: string; month?: number; quarter?: string }, @CurrentUser() user: AuthUser) {
    return this.fundRequests.submit(user, body);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  list(@CurrentUser() user: AuthUser) {
    return this.fundRequests.list(user);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.BUDGET_APPROVE)
  approve(@Param('id') id: string, @Body() body: { note?: string }, @CurrentUser() user: AuthUser) {
    return this.fundRequests.review(user, id, true, body?.note);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.BUDGET_APPROVE)
  reject(@Param('id') id: string, @Body() body: { note?: string }, @CurrentUser() user: AuthUser) {
    return this.fundRequests.review(user, id, false, body?.note);
  }
}
