import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { DebriefsService, type SubmitDebriefDto } from './debriefs.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';
import { PaginationDto } from '../../common/dto/pagination.dto';

// Submit DTO with light validation. Reads/writes are scoped in the service
// (you only ever see debriefs you submitted or that were routed to you), so no
// per-route permission is required — every authenticated field role can take
// part in the debrief workflow.
class SubmitDto implements SubmitDebriefDto {
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsIn(['staff', 'partner']) debriefType?: 'staff' | 'partner';
  @IsOptional() @IsString() partnerId?: string;
  @IsOptional() @IsString() responsibleStaffId?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsString() whatHappened?: string;
  @IsOptional() @IsString() whatWentWell?: string;
  @IsOptional() @IsString() whatDidNotGoWell?: string;
  @IsOptional() @IsArray() blockers?: string[];
  @IsOptional() @IsString() blockerOther?: string;
  @IsOptional() @IsString() supportNeeded?: string;
  @IsOptional() @IsString() recommendations?: string;
  @IsOptional() @IsString() nextAction?: string;
  @IsOptional() @IsArray() linkedSchoolIds?: string[];
  @IsOptional() @IsArray() linkedClusterIds?: string[];
  @IsOptional() @IsArray() linkedPartnerIds?: string[];
  @IsOptional() @IsArray() linkedProjectIds?: string[];
  @IsOptional() @IsArray() linkedActivityIds?: string[];
}

class MergeDto {
  @IsString() partnerDebriefId!: string;
  @IsOptional() @IsString() cceoDebriefId?: string;
  @IsOptional() @IsString() note?: string;
}

@ApiTags('debriefs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('debriefs')
export class DebriefsController {
  constructor(private readonly debriefs: DebriefsService) {}

  @Post()
  submit(@Body() dto: SubmitDto, @CurrentUser() user: AuthUser) {
    return this.debriefs.submit(user, dto);
  }

  @Get()
  list(@Query() q: PaginationDto, @CurrentUser() user: AuthUser) {
    return this.debriefs.list(user, q);
  }

  // Today's own debrief + partner inputs awaiting my review (CCEO).
  @Get('today')
  today(@CurrentUser() user: AuthUser) {
    return this.debriefs.today(user);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.debriefs.getOne(id, user);
  }

  // CCEO reviews + merges a partner debrief into their daily debrief, then it
  // routes upward to PL/CD/IA/HR.
  @Post('merge-partner-debrief')
  merge(@Body() dto: MergeDto, @CurrentUser() user: AuthUser) {
    return this.debriefs.mergePartnerDebrief(user, dto);
  }
}
