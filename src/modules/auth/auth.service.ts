import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { permissionsForRole } from '../../common/rbac/permissions';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase(), isActive: true, deletedAt: null },
      include: { staffProfile: true },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const activeRole =
      dto.activeRole && user.roles.includes(dto.activeRole) ? dto.activeRole : user.activeRole;

    const token = await this.jwt.signAsync({ sub: user.id, activeRole });
    await this.audit.log({ action: 'auth.login', actorId: user.id, actorRole: activeRole });

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        activeRole,
        permissions: permissionsForRole(activeRole),
        staffProfileId: user.staffProfile?.id ?? null,
      },
    };
  }
}
