import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityStatus, EdifyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';

// Backend AssignmentPolicyService — the API-enforced mirror of the frontend
// engine. Role rules + staff support capacity, applied before any assignment is
// persisted. CCEO → self|partner (own portfolio). PL → self (PL-owned) ·
// supervised CCEOs · partner (PL-owned or override). Partners are NEVER capped.

export const STAFF_SUPPORT_LIMIT_DEFAULT = 50;

// Activity statuses that DON'T count toward direct support (not yet committed work).
const EXCLUDED_STATUS: ActivityStatus[] = ['rejected', 'returned', 'rescheduled'];

export interface StaffCapacity {
  staffId: string;
  fy: string;
  max: number;
  used: number;
  remaining: number;
  atLimit: boolean;
  nearLimit: boolean;
}

export interface AssignmentOption {
  type: 'self' | 'staff' | 'partner';
  label: string;
  enabled: boolean;
  reason?: string;
  staffId?: string;
}

@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  private fyOrCurrent(fy?: string): string {
    return fy ?? getOperationalFY();
  }

  // ── Capacity ──────────────────────────────────────────────────────
  async limitFor(staffId: string, fy: string): Promise<number> {
    const c = await this.prisma.staffSupportCapacity.findUnique({ where: { staffId_fy: { staffId, fy } } });
    return c && c.isActive ? c.maxDirectSchoolsSupported : STAFF_SUPPORT_LIMIT_DEFAULT;
  }

  async getCapacity(staffId: string, fy?: string): Promise<StaffCapacity> {
    const resolvedFy = this.fyOrCurrent(fy);
    const rows = await this.prisma.activity.findMany({
      where: {
        responsibleStaffId: staffId, deliveryType: 'staff', fy: resolvedFy,
        deletedAt: null, schoolId: { not: null }, status: { notIn: EXCLUDED_STATUS },
      },
      select: { schoolId: true }, distinct: ['schoolId'],
    });
    const used = rows.length;
    const max = await this.limitFor(staffId, resolvedFy);
    return {
      staffId, fy: resolvedFy, max, used,
      remaining: Math.max(0, max - used),
      atLimit: used >= max,
      nearLimit: max > 0 && used / max >= 0.9 && used < max,
    };
  }

  async staffAlreadySupportsSchool(staffId: string, schoolId: string, fy: string): Promise<boolean> {
    const n = await this.prisma.activity.count({
      where: {
        responsibleStaffId: staffId, schoolId, deliveryType: 'staff', fy,
        deletedAt: null, status: { notIn: EXCLUDED_STATUS },
      },
    });
    return n > 0;
  }

  // CD/IA set a staff member's limit.
  async setCapacity(input: { staffId: string; fy: string; maxDirectSchoolsSupported: number; notes?: string }, user: AuthUser) {
    if (user.activeRole !== 'CountryDirector' && user.activeRole !== 'ImpactAssessment') {
      throw new ForbiddenException('Only CD or IA can set staff support capacity.');
    }
    const row = await this.prisma.staffSupportCapacity.upsert({
      where: { staffId_fy: { staffId: input.staffId, fy: input.fy } },
      update: { maxDirectSchoolsSupported: input.maxDirectSchoolsSupported, notes: input.notes, setByUserId: user.userId, setByRole: user.activeRole, isActive: true },
      create: { staffId: input.staffId, fy: input.fy, maxDirectSchoolsSupported: input.maxDirectSchoolsSupported, notes: input.notes, setByUserId: user.userId, setByRole: user.activeRole },
    });
    await this.audit.log({ action: 'capacity.set', subjectKind: 'StaffSupportCapacity', subjectId: row.id, actorId: user.userId, actorRole: user.activeRole, payload: { staffId: input.staffId, fy: input.fy, max: input.maxDirectSchoolsSupported } });
    return row;
  }

  // ── Decision engine ───────────────────────────────────────────────
  private async context(user: AuthUser, internalSchoolId: string, fy: string) {
    const scope = await this.scope.resolveUserScope(user);
    const isDirectOwner = scope.ownSchoolIds.includes(internalSchoolId);
    const isSupervisedSchool = scope.teamSchoolIds.includes(internalSchoolId);
    const staffId = user.staffProfileId ?? '';
    const capacity = staffId ? await this.getCapacity(staffId, fy) : { staffId: '', fy, max: 0, used: 0, remaining: 0, atLimit: true, nearLimit: false };
    const already = staffId ? await this.staffAlreadySupportsSchool(staffId, internalSchoolId, fy) : false;
    return { scope, isDirectOwner, isSupervisedSchool, staffId, capacity, already };
  }

  async getOptions(user: AuthUser, externalSchoolId: string, _activityType?: string, fy?: string): Promise<{ schoolId: string; fy: string; capacity: StaffCapacity; options: AssignmentOption[] }> {
    const resolvedFy = this.fyOrCurrent(fy);
    const school = await this.prisma.school.findUnique({ where: { schoolId: externalSchoolId }, select: { id: true, accountOwner: { include: { user: { select: { name: true } } } } } });
    if (!school) throw new NotFoundException(`School ${externalSchoolId} not found`);
    const ctx = await this.context(user, school.id, resolvedFy);
    const role = user.activeRole;
    const isCCEO = role === 'CCEO';
    const isPL = role === 'CountryProgramLead';
    const options: AssignmentOption[] = [];

    // SELF
    if (isCCEO || (isPL && ctx.isDirectOwner)) {
      const blocked = !ctx.already && ctx.capacity.remaining <= 0;
      options.push({ type: 'self', label: 'Assign to Myself', enabled: !blocked, reason: blocked ? `Direct support limit reached (${ctx.capacity.max} schools). Assign this to a partner.` : undefined });
    }
    // SUPERVISED CCEO (PL → the school's owner, if supervised)
    if (isPL && ctx.isSupervisedSchool) {
      const owner = await this.prisma.school.findUnique({ where: { id: school.id }, select: { accountOwnerId: true, accountOwner: { include: { user: { select: { name: true } } } } } });
      if (owner?.accountOwnerId) {
        const oc = await this.getCapacity(owner.accountOwnerId, resolvedFy);
        const ownerAlready = await this.staffAlreadySupportsSchool(owner.accountOwnerId, school.id, resolvedFy);
        const enabled = ownerAlready || oc.remaining > 0;
        options.push({ type: 'staff', label: `Assign to ${owner.accountOwner?.user.name ?? 'owner CCEO'}`, enabled, reason: enabled ? undefined : `That CCEO is at their support limit (${oc.max}).`, staffId: owner.accountOwnerId });
      }
    }
    // PARTNER
    const partner = this.canAssignToPartner(role, ctx.isDirectOwner);
    options.push({ type: 'partner', label: 'Assign to Partner', enabled: partner.allowed, reason: partner.reason });

    return { schoolId: externalSchoolId, fy: resolvedFy, capacity: ctx.capacity, options };
  }

  private canAssignToPartner(role: EdifyRole, isDirectOwner: boolean, overrideGranted = false): { allowed: boolean; reason?: string } {
    if (role === 'CCEO') return { allowed: true };
    if (role === 'CountryProgramLead') {
      if (isDirectOwner || overrideGranted) return { allowed: true };
      return { allowed: false, reason: 'This school belongs to a CCEO you supervise. Assign to the responsible CCEO, or request a partner-assignment override.' };
    }
    return { allowed: false, reason: 'Your role cannot assign partner work.' };
  }

  // ── Enforcement (called before persisting an activity) ────────────
  // internalSchoolId may be undefined for cluster-only activities (no per-school cap).
  async assertAssignmentAllowed(input: {
    user: AuthUser;
    internalSchoolId?: string;
    fy: string;
    responsibleStaffId?: string;
    assignedPartnerId?: string;
    overrideReason?: string;
  }): Promise<void> {
    const { user, internalSchoolId, fy } = input;
    const toPartner = !!input.assignedPartnerId;

    // Cluster-only (no school) — capacity is per-school, so nothing to enforce here.
    if (!internalSchoolId) return;

    const scope = await this.scope.resolveUserScope(user);
    const isDirectOwner = scope.ownSchoolIds.includes(internalSchoolId);
    const isSupervisedSchool = scope.teamSchoolIds.includes(internalSchoolId);

    const writeAudit = (allowed: boolean, reason?: string) =>
      this.prisma.assignmentAudit.create({
        data: {
          action: toPartner ? 'assign.partner' : (input.responsibleStaffId && input.responsibleStaffId !== user.staffProfileId ? 'assign.staff' : 'assign.self'),
          schoolId: internalSchoolId, assignerId: user.userId, assignerRole: user.activeRole,
          assignedToType: toPartner ? 'partner' : 'staff',
          assignedStaffId: toPartner ? null : (input.responsibleStaffId ?? user.staffProfileId),
          assignedPartnerId: input.assignedPartnerId ?? null,
          allowed, blockedReason: reason ?? null,
          overrideUsed: !!input.overrideReason, overrideReason: input.overrideReason ?? null,
        },
      });

    const block = async (reason: string): Promise<never> => {
      await writeAudit(false, reason);
      throw new ForbiddenException(reason);
    };

    if (toPartner) {
      const p = this.canAssignToPartner(user.activeRole, isDirectOwner, !!input.overrideReason);
      if (!p.allowed) await block(p.reason ?? 'Partner assignment not allowed.');
      await writeAudit(true);
      return;
    }

    // Staff-delivered. Resolve the assignee.
    const assignee = input.responsibleStaffId ?? user.staffProfileId;
    if (!assignee) await block('No staff assignee resolved.');

    const isSelf = assignee === user.staffProfileId;
    if (isSelf) {
      if (user.activeRole !== 'CCEO' && user.activeRole !== 'CountryProgramLead') await block('Your role does not deliver direct school support.');
      if (user.activeRole === 'CountryProgramLead' && !isDirectOwner) {
        await block('You can only self-assign for schools you directly own. Assign to the responsible CCEO.');
      }
    } else {
      // Assigning to another staff member — only a PL, only a supervised CCEO.
      if (user.activeRole !== 'CountryProgramLead') await block('Only a Program Lead can assign to another staff member.');
      if (!scope.supervisedStaffIds.includes(assignee!)) await block('That staff member is not on your supervised team.');
      if (!isSupervisedSchool && !isDirectOwner) await block('That school is not in your team scope.');
    }

    // Capacity gate for the assignee (skip if they already support this school).
    const already = await this.staffAlreadySupportsSchool(assignee!, internalSchoolId, fy);
    if (!already) {
      const cap = await this.getCapacity(assignee!, fy);
      if (cap.remaining <= 0) {
        await block(`Direct support limit reached (${cap.max} schools). Assign this to a partner.`);
      }
    }
    await writeAudit(true);
  }
}
