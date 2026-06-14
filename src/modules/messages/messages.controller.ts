import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) { return this.messages.list(user, q); }

  @Get('recent')
  recent(@CurrentUser() user: AuthUser) { return this.messages.recent(user); }

  @Get('counts')
  counts(@CurrentUser() user: AuthUser) { return this.messages.counts(user); }

  @Get('recipients')
  recipients(@CurrentUser() user: AuthUser) { return this.messages.recipients(user); }

  @Get('thread/:id')
  thread(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.messages.thread(user, id); }

  @Post()
  send(@Body() dto: { recipientId?: string; subject?: string; body?: string; contextType?: string; contextId?: string; category?: string }, @CurrentUser() user: AuthUser) {
    return this.messages.send(user, dto);
  }

  @Post(':id/reply')
  reply(@Param('id') id: string, @Body() dto: { body?: string }, @CurrentUser() user: AuthUser) {
    return this.messages.reply(user, id, dto);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.messages.markRead(id, user); }
}
