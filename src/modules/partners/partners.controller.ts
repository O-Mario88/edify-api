import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PartnersService } from './partners.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('partners')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  // Partner directory (governance view) — visible to roles that assign/oversee.
  @Get()
  @RequirePermissions(PERMISSIONS.PARTNER_VIEW)
  list(@Query('activeOnly') activeOnly: string, @CurrentUser() user: AuthUser) {
    return this.partners.list(user, activeOnly === 'true');
  }

  // The partner org the CALLER logs in as (round-trip: a field officer's session).
  @Get('me')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  me(@CurrentUser() user: AuthUser) {
    return this.partners.myPartner(user);
  }

  // Activities assigned to the caller's partner — their own work queue.
  @Get('me/activities')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  myActivities(@CurrentUser() user: AuthUser) {
    return this.partners.myActivities(user);
  }

  // Eligible partners for an assignment (active + geography + expertise).
  @Get('eligible')
  @RequirePermissions(PERMISSIONS.PARTNER_VIEW)
  eligible(@Query('districtName') districtName: string, @Query('expertise') expertise: string, @CurrentUser() user: AuthUser) {
    return this.partners.eligible(user, { districtName, expertise });
  }

  // CD onboards a partner.
  @Post()
  @RequirePermissions(PERMISSIONS.PARTNER_MANAGE)
  onboard(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.partners.onboard(user, body);
  }

  // CD updates / activates / deactivates / certifies / sets coverage.
  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PARTNER_MANAGE)
  update(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.partners.update(user, id, body);
  }
}
