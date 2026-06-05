import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationDto) { return this.notifications.list(user, q); }

  @Get('recent')
  recent(@CurrentUser() user: AuthUser) { return this.notifications.recent(user); }

  @Get('counts')
  counts(@CurrentUser() user: AuthUser) { return this.notifications.counts(user); }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.notifications.markRead(id, user); }

  @Patch('mark-all-read')
  markAllRead(@CurrentUser() user: AuthUser) { return this.notifications.markAllRead(user); }
}
