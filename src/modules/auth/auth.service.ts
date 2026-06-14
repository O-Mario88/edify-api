import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { permissionsForRole } from '../../common/rbac/permissions';
import { LoginDto } from './dto/login.dto';

// Brute-force protection (spec §5): lock an account after N consecutive failed
// sign-ins for a cool-off window. Tunable via env.
const MAX_FAILED = Number(process.env.AUTH_MAX_FAILED_LOGINS ?? 5);
const LOCK_MINUTES = Number(process.env.AUTH_LOCK_MINUTES ?? 15);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    // Look the user up WITHOUT the isActive filter so lockout state is tracked
    // even for a disabled account; we still require active for a successful login.
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null }, include: { staffProfile: true } });

    // Locked? Reject before checking the password (and don't reset the clock).
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.log({ action: 'auth.login.locked', actorId: user.id, actorRole: user.activeRole, success: false, reason: 'account-locked', payload: { email } });
      throw new ForbiddenException('Account is temporarily locked due to repeated failed sign-ins. Try again later.');
    }

    const passwordOk = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;
    if (!user || !passwordOk || !user.isActive) {
      // Count the failure + lock at the threshold. Generic error either way to
      // avoid user enumeration.
      if (user) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= MAX_FAILED;
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil },
        });
        await this.audit.log({ action: lock ? 'auth.login.lockout' : 'auth.login.failed', actorId: user.id, actorRole: user.activeRole, success: false, reason: lock ? 'lockout-threshold' : 'bad-password', payload: { email, attempt: failed } });
      } else {
        await this.audit.log({ action: 'auth.login.failed', success: false, reason: 'unknown-user', payload: { email } });
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    // Success — clear any failure counter.
    if (user.failedLoginCount !== 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    }

    const activeRole =
      dto.activeRole && user.roles.includes(dto.activeRole) ? dto.activeRole : user.activeRole;

    const token = await this.jwt.signAsync({ sub: user.id, activeRole });
    await this.audit.log({ action: 'auth.login', actorId: user.id, actorRole: activeRole, success: true });

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
