import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FlagsService } from './flags.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

// CD → PL flag handoff. Role enforcement lives in the service (only the CD may
// raise; only the assigned PL may act). Auth required for all.
@ApiTags('flags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('flags')
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Post()
  raise(
    @CurrentUser() user: AuthUser,
    @Body() body: { assignedToUserId?: string; category?: string; note?: string; scopeType?: string; scopeId?: string; scopeName?: string; recommendedAction?: string; priority?: string; dueDate?: string },
  ) {
    return this.flags.raise(user, body);
  }

  @Get('program-leads')
  programLeads() {
    return this.flags.programLeads();
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.flags.list(user, status);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { action?: 'acknowledge' | 'resolve'; note?: string },
  ) {
    return this.flags.update(user, id, body?.action === 'resolve' ? 'resolve' : 'acknowledge', body?.note);
  }
}
