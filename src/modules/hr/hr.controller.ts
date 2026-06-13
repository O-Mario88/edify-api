import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HrService } from './hr.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('hr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr')
export class HrController {
  constructor(private readonly hr: HrService) {}

  @Get('roster')
  roster() {
    return this.hr.roster();
  }

  @Get('leave')
  leave(@CurrentUser() user: AuthUser) {
    return this.hr.listLeave(user);
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
