import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';
import { ScopeService } from '../../common/scope/scope.service';
import { permissionsForRole } from '../../common/rbac/permissions';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly scope: ScopeService,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const s = await this.scope.resolveUserScope(user);
    // Return capability flags, not the internal id sets.
    return {
      ...user,
      permissions: permissionsForRole(user.activeRole),
      scope: {
        countryScope: s.countryScope,
        canViewSummaryOnly: s.canViewSummaryOnly,
        canViewSchoolLevelDetail: s.canViewSchoolLevelDetail,
        canViewPartnerData: s.canViewPartnerData,
        canViewFinancialData: s.canViewFinancialData,
        canApprove: s.canApprove,
        canAssign: s.canAssign,
        canExport: s.canExport,
        schoolsInScope: s.countryScope ? null : s.schoolIds.length,
      },
    };
  }
}
