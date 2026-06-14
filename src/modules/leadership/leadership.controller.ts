import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';
import { LeadershipService } from './leadership.service';
import { DecisionNoteDto, LeadershipQueryDto, RecomputeDto, ReviewDecisionDto } from './dto/leadership.dto';

// The Leadership Decision Engine. View is gated on LEADERSHIP_ENGINE_VIEW
// (role-tailored boards inside the service); the human-review actions require
// LEADERSHIP_DECISION_REVIEW. NOTHING here executes an employment/MOU/recruit
// action — every endpoint only recommends or records a human decision.
@ApiTags('leadership')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.LEADERSHIP_ENGINE_VIEW)
@Controller('leadership/decision-engine')
export class LeadershipController {
  constructor(private readonly leadership: LeadershipService) {}

  @Get()
  boards(@Query() q: LeadershipQueryDto, @CurrentUser() u: AuthUser) {
    return this.leadership.boards(u, q);
  }

  @Get('snapshot')
  snapshot(@Query('fy') fy: string | undefined, @CurrentUser() u: AuthUser) {
    return this.leadership.snapshot(u, fy);
  }

  @Get('recruitment')
  recruitment(@Query() q: LeadershipQueryDto, @CurrentUser() u: AuthUser) {
    return this.leadership.boards(u, { ...q, decisionType: 'recruitment' });
  }

  @Get('staff-addition')
  staffAddition(@Query() q: LeadershipQueryDto, @CurrentUser() u: AuthUser) {
    return this.leadership.boards(u, { ...q, decisionType: 'staff_addition' });
  }

  @Get('partners')
  partners(@Query() q: LeadershipQueryDto, @CurrentUser() u: AuthUser) {
    return this.leadership.boards(u, { ...q, decisionType: 'partner' });
  }

  @Get('staff')
  staff(@Query() q: LeadershipQueryDto, @CurrentUser() u: AuthUser) {
    return this.leadership.boards(u, { ...q, decisionType: 'staff_hr' });
  }

  @Get('regional-investment')
  regional(@Query() q: LeadershipQueryDto, @CurrentUser() u: AuthUser) {
    return this.leadership.boards(u, { ...q, decisionType: 'regional_investment' });
  }

  @Get('insight/:id')
  insight(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.leadership.getInsight(u, id);
  }

  @Get('insight/:id/memo')
  memo(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.leadership.memo(u, id);
  }

  @Post('insight/:id/review')
  @RequirePermissions(PERMISSIONS.LEADERSHIP_DECISION_REVIEW)
  review(@Param('id') id: string, @Body() body: ReviewDecisionDto, @CurrentUser() u: AuthUser) {
    return this.leadership.review(u, id, body.status, body.note);
  }

  @Post('insight/:id/note')
  note(@Param('id') id: string, @Body() body: DecisionNoteDto, @CurrentUser() u: AuthUser) {
    return this.leadership.addNote(u, id, body.note, body.kind);
  }

  @Post('recompute')
  @RequirePermissions(PERMISSIONS.LEADERSHIP_DECISION_REVIEW)
  recompute(@Body() body: RecomputeDto) {
    return this.leadership.recompute(body.fy);
  }
}
