import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EdifyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventService, type NotifySpec } from '../../common/realtime/domain-events.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';

// Blockers that signal a DATA / evidence / Salesforce issue — these flag the IA
// recipient as action-required (spec §13: "Debrief reports Salesforce/evidence blocker").
const IA_BLOCKERS = ['evidence_missing', 'salesforce_entry_issue', 'data_collection_issue'];

type Recipient = { userId: string; role: EdifyRole; reason: string; actionRequired: boolean };

export type SubmitDebriefDto = {
  date?: string;
  debriefType?: 'staff' | 'partner';
  partnerId?: string;
  responsibleStaffId?: string;
  summary?: string;
  whatHappened?: string;
  whatWentWell?: string;
  whatDidNotGoWell?: string;
  blockers?: string[];
  blockerOther?: string;
  supportNeeded?: string;
  recommendations?: string;
  nextAction?: string;
  linkedSchoolIds?: string[];
  linkedClusterIds?: string[];
  linkedPartnerIds?: string[];
  linkedProjectIds?: string[];
  linkedActivityIds?: string[];
};

@Injectable()
export class DebriefsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
  ) {}

  // ── Submit (the daily field-truth record) ─────────────────────────
  async submit(user: AuthUser, dto: SubmitDebriefDto) {
    const fy = getOperationalFY();
    const date = dto.date ? new Date(dto.date) : new Date();
    const isPartner = user.activeRole === 'PartnerAdmin' || user.activeRole === 'PartnerFieldOfficer';
    const debriefType = dto.debriefType ?? (isPartner ? 'partner' : 'staff');
    const blockers = dto.blockers ?? [];

    const debrief = await this.prisma.dailyDebrief.create({
      data: {
        fy, date,
        submittedByUserId: user.userId, submittedByRole: user.activeRole,
        staffId: debriefType === 'partner' ? null : user.staffProfileId ?? null,
        partnerId: dto.partnerId ?? null,
        debriefType: debriefType as never, status: 'submitted',
        summary: dto.summary, whatHappened: dto.whatHappened, whatWentWell: dto.whatWentWell, whatDidNotGoWell: dto.whatDidNotGoWell,
        blockers, blockerOther: dto.blockerOther,
        supportNeeded: dto.supportNeeded, recommendations: dto.recommendations, nextAction: dto.nextAction,
        linkedSchoolIds: dto.linkedSchoolIds ?? [], linkedClusterIds: dto.linkedClusterIds ?? [],
        linkedPartnerIds: dto.linkedPartnerIds ?? (dto.partnerId ? [dto.partnerId] : []),
        linkedProjectIds: dto.linkedProjectIds ?? [], linkedActivityIds: dto.linkedActivityIds ?? [],
        submittedAt: new Date(),
      },
    });

    const recipients = debriefType === 'partner'
      ? await this.partnerRecipients(dto.partnerId ?? null, dto.responsibleStaffId ?? null)
      : await this.staffRecipients(user, blockers);

    await this.routeTo(debrief.id, recipients, user, debriefType === 'partner' ? 'PartnerDebriefSubmitted' : 'DebriefSubmitted', blockers);
    return { ...debrief, routedTo: recipients.length };
  }

  // Create recipient rows + fire the domain event (audit + notifications + realtime).
  private async routeTo(debriefId: string, recipients: Recipient[], actor: AuthUser, type: string, blockers: string[]) {
    for (const r of recipients) {
      await this.prisma.dailyDebriefRecipient.create({
        data: { debriefId, recipientUserId: r.userId, recipientRole: r.role, routingReason: r.reason, actionRequired: r.actionRequired },
      });
    }
    const blockerLine = blockers.length ? `Blockers: ${blockers.slice(0, 3).join(', ')}${blockers.length > 3 ? '…' : ''}` : 'No blockers reported.';
    const isPartner = type === 'PartnerDebriefSubmitted';
    const notify: NotifySpec[] = recipients.map((r) => ({
      recipientId: r.userId,
      title: isPartner
        ? `Partner submitted today's debrief — review & merge`
        : type === 'PartnerDebriefMerged'
          ? `Merged debrief (staff + partner input) from ${actor.name}`
          : `Daily debrief submitted by ${actor.name}`,
      body: blockerLine,
      targetRoute: `/debriefs/${debriefId}`,
      contextType: 'daily_debrief', contextId: debriefId,
      actionRequired: r.actionRequired,
      priority: r.actionRequired ? 'high' : 'normal',
    }));
    await this.events.emit({
      type, actorId: actor.userId, actorRole: actor.activeRole,
      subjectKind: 'DailyDebrief', subjectId: debriefId,
      payload: { blockers }, notify, liveUserIds: [actor.userId],
    });
  }

  // Staff debrief routing (spec §5): CCEO → PL + CD + IA + HR; PL → CD + IA + HR.
  private async staffRecipients(user: AuthUser, blockers: string[]): Promise<Recipient[]> {
    const out: Recipient[] = [];
    const iaAction = blockers.some((b) => IA_BLOCKERS.includes(b));
    if (user.activeRole === 'CCEO' && user.staffProfileId) {
      const plUserId = await this.supervisorUserFor(user.staffProfileId);
      if (plUserId) out.push({ userId: plUserId, role: 'CountryProgramLead', reason: 'Supervising Program Lead', actionRequired: false });
    }
    const role: [EdifyRole, boolean][] = [
      ['CountryDirector', false],
      ['ImpactAssessment', iaAction],
      ['HumanResources', false],
    ];
    for (const [r, action] of role) {
      for (const id of await this.events.usersWithRole(r)) {
        out.push({ userId: id, role: r, reason: `${r} routing`, actionRequired: action });
      }
    }
    return this.dedupe(out, user.userId);
  }

  // Partner debrief routing (spec §6): first to the responsible CCEO for review.
  private async partnerRecipients(partnerId: string | null, responsibleStaffId: string | null): Promise<Recipient[]> {
    let staffId = responsibleStaffId;
    if (!staffId && partnerId) {
      const act = await this.prisma.activity.findFirst({
        where: { assignedPartnerId: partnerId, deletedAt: null },
        select: { responsibleStaffId: true, monitoredByStaffId: true }, orderBy: { createdAt: 'desc' },
      });
      staffId = act?.monitoredByStaffId ?? act?.responsibleStaffId ?? null;
    }
    if (!staffId) return [];
    const userId = await this.events.userForStaff(staffId);
    return userId ? [{ userId, role: 'CCEO', reason: 'Responsible CCEO — review & merge', actionRequired: true }] : [];
  }

  private async supervisorUserFor(staffProfileId: string): Promise<string | null> {
    const link = await this.prisma.staffSupervisorAssignment.findFirst({ where: { superviseeId: staffProfileId }, select: { supervisorId: true } });
    if (!link) return null;
    return this.events.userForStaff(link.supervisorId);
  }

  private dedupe(rs: Recipient[], excludeUserId: string): Recipient[] {
    const seen = new Set<string>();
    const out: Recipient[] = [];
    for (const r of rs) {
      if (r.userId === excludeUserId || seen.has(r.userId)) continue;
      seen.add(r.userId);
      out.push(r);
    }
    return out;
  }

  // ── Scoped reads ──────────────────────────────────────────────────
  private scopeWhere(user: AuthUser): Prisma.DailyDebriefWhereInput {
    // You see a debrief if you submitted it OR it was routed to you.
    return {
      deletedAt: null,
      OR: [{ submittedByUserId: user.userId }, { recipients: { some: { recipientUserId: user.userId } } }],
    };
  }

  async list(user: AuthUser, q: PaginationDto) {
    const where = this.scopeWhere(user);
    const [rows, total] = await Promise.all([
      this.prisma.dailyDebrief.findMany({ where, skip: q.skip, take: q.take, orderBy: { submittedAt: 'desc' }, include: { recipients: true } }),
      this.prisma.dailyDebrief.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  async getOne(id: string, user: AuthUser) {
    const d = await this.prisma.dailyDebrief.findFirst({ where: { id, ...this.scopeWhere(user) }, include: { recipients: true } });
    if (!d) throw new NotFoundException('Debrief not found or not in your scope');
    // Mark my recipient row read.
    await this.prisma.dailyDebriefRecipient.updateMany({ where: { debriefId: id, recipientUserId: user.userId, readAt: null }, data: { readAt: new Date() } });
    return d;
  }

  // Today: my own debrief(s) + partner inputs awaiting my review (CCEO).
  async today(user: AuthUser) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const mine = await this.prisma.dailyDebrief.findMany({
      where: { deletedAt: null, submittedByUserId: user.userId, date: { gte: start } }, orderBy: { submittedAt: 'desc' }, take: 50,
    });
    const partnerInputs = await this.prisma.dailyDebrief.findMany({
      where: { deletedAt: null, debriefType: 'partner', status: 'submitted', mergedIntoDebriefId: null, recipients: { some: { recipientUserId: user.userId } } },
      orderBy: { submittedAt: 'desc' }, take: 100,
    });
    return { submittedToday: mine.length > 0, mine, partnerInputs };
  }

  // ── Merge a partner debrief into the CCEO debrief (spec §8/§9) ─────
  async mergePartnerDebrief(user: AuthUser, body: { partnerDebriefId: string; cceoDebriefId?: string; note?: string }) {
    const partner = await this.prisma.dailyDebrief.findFirst({
      where: { id: body.partnerDebriefId, debriefType: 'partner', recipients: { some: { recipientUserId: user.userId } } },
    });
    if (!partner) throw new NotFoundException('Partner debrief not found in your review queue');
    if (partner.mergedIntoDebriefId) throw new ForbiddenException('Already merged');

    // Find or create the CCEO debrief for the partner's date.
    let cceo = body.cceoDebriefId
      ? await this.prisma.dailyDebrief.findFirst({ where: { id: body.cceoDebriefId, submittedByUserId: user.userId } })
      : await this.prisma.dailyDebrief.findFirst({ where: { submittedByUserId: user.userId, debriefType: { in: ['staff', 'merged'] }, date: { gte: startOfDay(partner.date) }, deletedAt: null }, orderBy: { submittedAt: 'desc' } });
    if (!cceo) {
      cceo = await this.prisma.dailyDebrief.create({
        data: {
          fy: partner.fy, date: partner.date, submittedByUserId: user.userId, submittedByRole: user.activeRole,
          staffId: user.staffProfileId ?? null, debriefType: 'merged', status: 'merged',
          summary: 'Merged from partner input', whatHappened: partner.whatHappened,
          blockers: partner.blockers, linkedSchoolIds: partner.linkedSchoolIds, linkedPartnerIds: partner.linkedPartnerIds,
          linkedActivityIds: partner.linkedActivityIds, reviewNote: body.note,
        },
      });
    } else {
      cceo = await this.prisma.dailyDebrief.update({
        where: { id: cceo.id },
        data: {
          debriefType: 'merged', status: 'merged', reviewNote: body.note,
          linkedSchoolIds: Array.from(new Set([...cceo.linkedSchoolIds, ...partner.linkedSchoolIds])),
          linkedPartnerIds: Array.from(new Set([...cceo.linkedPartnerIds, ...partner.linkedPartnerIds])),
          linkedActivityIds: Array.from(new Set([...cceo.linkedActivityIds, ...partner.linkedActivityIds])),
        },
      });
    }

    // Preserve the partner debrief; just link it (never overwrite).
    await this.prisma.dailyDebrief.update({
      where: { id: partner.id },
      data: { status: 'merged', mergedIntoDebriefId: cceo.id, reviewedByUserId: user.userId, reviewedAt: new Date(), parentDebriefId: cceo.id },
    });

    // Route the merged debrief upward to PL/CD/IA/HR.
    const recipients = await this.staffRecipients(user, cceo.blockers);
    await this.routeTo(cceo.id, recipients, user, 'PartnerDebriefMerged', cceo.blockers);
    return { merged: cceo, partnerDebriefId: partner.id, routedTo: recipients.length };
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
