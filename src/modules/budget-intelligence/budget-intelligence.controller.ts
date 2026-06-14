import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';
import { BudgetIntelligenceService } from './budget-intelligence.service';

interface BiQuery { fy?: string; insightType?: string; impactYield?: string; riskLevel?: string }

// Budget Intelligence & Financial Decision Engine. View is gated on
// BUDGET_INTELLIGENCE_VIEW; the human finance-decision actions (review +
// recompute) require BUDGET_DECISION_REVIEW. NOTHING here moves money — every
// endpoint only recommends or records a human finance decision.
@ApiTags('budget-intelligence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.BUDGET_INTELLIGENCE_VIEW)
@Controller('budget-intelligence')
export class BudgetIntelligenceController {
  constructor(private readonly bi: BudgetIntelligenceService) {}

  @Get()
  boards(@Query() q: BiQuery, @CurrentUser() u: AuthUser) { return this.bi.boards(u, q); }

  @Get('snapshot')
  snapshot(@Query('fy') fy: string | undefined, @CurrentUser() u: AuthUser) { return this.bi.snapshot(u, fy); }

  @Get('monthly')
  monthly(@Query() q: BiQuery, @CurrentUser() u: AuthUser) { return this.bi.boards(u, { ...q, insightType: 'monthly' }); }

  @Get('partners')
  partners(@Query() q: BiQuery, @CurrentUser() u: AuthUser) { return this.bi.boards(u, { ...q, insightType: 'partner' }); }

  @Get('activities')
  activities(@Query() q: BiQuery, @CurrentUser() u: AuthUser) { return this.bi.boards(u, { ...q, insightType: 'activity' }); }

  @Get('regions')
  regions(@Query() q: BiQuery, @CurrentUser() u: AuthUser) { return this.bi.boards(u, { ...q, insightType: 'regional' }); }

  @Get('insight/:id')
  insight(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.bi.getInsight(u, id); }

  @Get('insight/:id/memo')
  memo(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.bi.memo(u, id); }

  @Post('insight/:id/review')
  @RequirePermissions(PERMISSIONS.BUDGET_DECISION_REVIEW)
  review(@Param('id') id: string, @Body() body: { status: string; note?: string }, @CurrentUser() u: AuthUser) {
    return this.bi.review(u, id, body.status, body.note);
  }

  @Post('insight/:id/note')
  note(@Param('id') id: string, @Body() body: { note: string; kind?: string }, @CurrentUser() u: AuthUser) {
    return this.bi.addNote(u, id, body.note, body.kind);
  }

  @Post('recompute')
  @RequirePermissions(PERMISSIONS.BUDGET_DECISION_REVIEW)
  recompute(@Body() body: { fy?: string }) { return this.bi.recompute(body?.fy); }
}
