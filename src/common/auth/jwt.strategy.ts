import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EdifyRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from './auth-user';

export interface JwtPayload {
  sub: string;
  activeRole: EdifyRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true, deletedAt: null },
      include: { staffProfile: true },
    });
    if (!user) throw new UnauthorizedException('User not found or inactive');

    const activeRole = user.roles.includes(payload.activeRole) ? payload.activeRole : user.activeRole;
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      activeRole,
      staffProfileId: user.staffProfile?.id,
    };
  }
}
