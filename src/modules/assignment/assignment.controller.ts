import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AssignmentService } from './assignment.service';
import { AssignmentOptionsQueryDto, CapacityQueryDto, SetCapacityDto } from './dto/assignment.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('assignment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('assignment')
export class AssignmentController {
  constructor(private readonly assignment: AssignmentService) {}

  // Valid assignment options for a school (role + capacity aware).
  @Get('options')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  options(@Query() q: AssignmentOptionsQueryDto, @CurrentUser() user: AuthUser) {
    return this.assignment.getOptions(user, q.schoolId, q.activityType, q.fy);
  }

  // Direct-support capacity for a staff member (defaults to the caller).
  @Get('capacity')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  capacity(@Query() q: CapacityQueryDto, @CurrentUser() user: AuthUser) {
    return this.assignment.getCapacity(q.staffId ?? user.staffProfileId ?? '', q.fy);
  }

  // CD/IA set a staff member's direct-support limit (role re-checked in service).
  @Post('capacity')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  setCapacity(@Body() dto: SetCapacityDto, @CurrentUser() user: AuthUser) {
    return this.assignment.setCapacity(dto, user);
  }
}
