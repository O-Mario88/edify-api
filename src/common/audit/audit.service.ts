import { Injectable } from '@nestjs/common';
import { EdifyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditInput {
  action: string;
  subjectKind?: string;
  subjectId?: string;
  actorId?: string;
  actorRole?: EdifyRole;
  payload?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: input.action,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        actorId: input.actorId,
        actorRole: input.actorRole,
        payload: input.payload ?? Prisma.JsonNull,
      },
    });
  }
}
