import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActivitiesService } from './activities.service';
import { CompleteActivityDto, CreateActivityDto, QueryActivitiesDto } from './dto/activities.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('activities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  list(@Query() query: QueryActivitiesDto, @CurrentUser() user: AuthUser) {
    return this.activities.list(query, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ACTIVITY_ASSIGN)
  create(@Body() dto: CreateActivityDto, @CurrentUser() user: AuthUser) {
    return this.activities.create(dto, user);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.ACTIVITY_COMPLETE)
  complete(@Param('id') id: string, @Body() dto: CompleteActivityDto, @CurrentUser() user: AuthUser) {
    return this.activities.complete(id, dto, user);
  }

  @Post(':id/ia-confirm')
  @RequirePermissions(PERMISSIONS.IA_VERIFY)
  iaConfirm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.activities.iaConfirm(id, user);
  }
}
