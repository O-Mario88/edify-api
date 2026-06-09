import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CommandCenterService } from './command-center.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

// The recommendation-led home feed. Every authenticated role gets a
// role-scoped "what must I do next" list — no permission gate beyond auth,
// because the service tailors the feed to the caller's role + scope.
@ApiTags('command-center')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('command-center')
export class CommandCenterController {
  constructor(private readonly cc: CommandCenterService) {}

  @Get('today')
  today(@CurrentUser() user: AuthUser) {
    return this.cc.today(user);
  }
}
