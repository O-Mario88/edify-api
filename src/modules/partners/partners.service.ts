import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';

// Partners — onboarded and governed by the Country Director. Eligibility for
// assignment (active + geography + expertise + certification) is derived from
// this onboarding data; staff can only assign active, eligible partners.

type OnboardBody = {
  name?: string; contactPerson?: string; email?: string; phone?: string;
  regionName?: string; coverageDistricts?: string[]; expertiseAreas?: string[];
  trainsOn?: string[]; isCertified?: boolean; certificationStatus?: string;
  contractStatus?: string; activeStatus?: boolean; notes?: string;
};

const ACTIVE_ACTIVITY = ['planned', 'scheduled', 'assigned_to_partner', 'partner_scheduled', 'in_progress', 'evidence_uploaded', 'evidence_accepted', 'salesforce_id_required', 'awaiting_ia_verification'];

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private shape(p: { id: string; name: string; regionName: string | null; coverageDistricts: string[]; expertiseAreas: string[]; trainsOn: string[]; isCertified: boolean; certificationStatus: string | null; activeStatus: boolean; contractStatus: string | null; contactPerson: string | null; email: string | null; phone: string | null; onboardedAt: Date | null }) {
    return {
      id: p.id, name: p.name, contactPerson: p.contactPerson, email: p.email, phone: p.phone,
      regionName: p.regionName, coverageDistricts: p.coverageDistricts, expertiseAreas: p.expertiseAreas, trainsOn: p.trainsOn,
      isCertified: p.isCertified, certificationStatus: p.certificationStatus, activeStatus: p.activeStatus,
      contractStatus: p.contractStatus, onboardedAt: p.onboardedAt,
    };
  }

  /** CD onboards a partner organization. */
  async onboard(user: AuthUser, body: OnboardBody) {
    const name = (body.name ?? '').trim();
    if (!name) throw new BadRequestException('Partner organization name is required.');
    const p = await this.prisma.partner.create({
      data: {
        name, contactPerson: body.contactPerson, email: body.email, phone: body.phone,
        regionName: body.regionName, coverageDistricts: body.coverageDistricts ?? [],
        expertiseAreas: body.expertiseAreas ?? [], trainsOn: body.trainsOn ?? [],
        isCertified: body.isCertified ?? false, certificationStatus: body.certificationStatus ?? 'none',
        contractStatus: body.contractStatus ?? 'pending', activeStatus: body.activeStatus ?? true,
        notes: body.notes, onboardedByUserId: user.userId, onboardedAt: new Date(),
      },
    });
    await this.audit.log({ action: 'partner.onboard', subjectKind: 'Partner', subjectId: p.id, actorId: user.userId, actorRole: user.activeRole, payload: { name } });
    return this.shape(p);
  }

  /** Update / activate / deactivate / certify / set coverage. */
  async update(user: AuthUser, id: string, body: OnboardBody) {
    const exists = await this.prisma.partner.findFirst({ where: { id, deletedAt: null } });
    if (!exists) throw new NotFoundException('Partner not found');
    const data: Prisma.PartnerUpdateInput = {};
    for (const k of ['name', 'contactPerson', 'email', 'phone', 'regionName', 'certificationStatus', 'contractStatus', 'notes'] as const)
      if (body[k] !== undefined) (data as Record<string, unknown>)[k] = body[k];
    for (const k of ['coverageDistricts', 'expertiseAreas', 'trainsOn'] as const)
      if (body[k] !== undefined) (data as Record<string, unknown>)[k] = body[k];
    if (body.isCertified !== undefined) data.isCertified = body.isCertified;
    if (body.activeStatus !== undefined) data.activeStatus = body.activeStatus;
    const p = await this.prisma.partner.update({ where: { id }, data });
    await this.audit.log({ action: 'partner.update', subjectKind: 'Partner', subjectId: id, actorId: user.userId, actorRole: user.activeRole, payload: { changed: Object.keys(data) } });
    return this.shape(p);
  }

  /** Full partner list (governance view). */
  async list(_user: AuthUser, activeOnly = false) {
    const partners = await this.prisma.partner.findMany({
      where: { deletedAt: null, ...(activeOnly ? { activeStatus: true } : {}) },
      orderBy: { name: 'asc' }, take: 1000,
    });
    return partners.map((p) => this.shape(p));
  }

  /** The Partner organization the CALLER authenticates as (round-trip seam).
   *  A partner field officer's session is scoped to this one record. */
  async myPartner(user: AuthUser) {
    const p = await this.prisma.partner.findFirst({ where: { deletedAt: null, userId: user.userId } });
    if (!p) throw new NotFoundException('No partner organization is linked to this account.');
    return this.shape(p);
  }

  /** Activities assigned TO the caller's partner — the work that round-trips
   *  back from a staffer's "assign to partner" into the partner's own queue. */
  async myActivities(user: AuthUser) {
    const partner = await this.prisma.partner.findFirst({ where: { deletedAt: null, userId: user.userId } });
    if (!partner) throw new NotFoundException('No partner organization is linked to this account.');
    const rows = await this.prisma.activity.findMany({
      where: { deletedAt: null, assignedPartnerId: partner.id },
      orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'desc' }], take: 500,
      include: { school: { select: { name: true, district: { select: { name: true } } } } },
    });
    const activities = rows.map((a) => ({
      id: a.id, activityType: a.activityType, schoolName: a.school?.name ?? null,
      district: a.school?.district?.name ?? null, status: a.status, evidenceStatus: a.evidenceStatus,
      scheduledDate: a.scheduledDate, fy: a.fy, deliveryType: a.deliveryType,
    }));
    const closed = ['completed', 'ia_verified', 'paid', 'closed', 'cancelled'];
    const counts = {
      total: activities.length,
      open: activities.filter((a) => !closed.includes(a.status as string)).length,
      awaitingEvidence: activities.filter((a) => a.evidenceStatus === 'none' || a.evidenceStatus === 'returned').length,
      scheduled: activities.filter((a) => a.scheduledDate != null).length,
    };
    return { partner: this.shape(partner), counts, activities };
  }

  /** Eligible partners for an assignment: ACTIVE + (covers the district OR no
   *  coverage set = nationwide) + (has the expertise, if a technical area is
   *  requested). Includes certification + current workload so staff can choose. */
  async eligible(_user: AuthUser, opts: { districtName?: string; expertise?: string }) {
    const partners = await this.prisma.partner.findMany({
      where: { deletedAt: null, activeStatus: true }, orderBy: { name: 'asc' }, take: 500,
      include: { _count: { select: { activities: { where: { deletedAt: null, status: { in: ACTIVE_ACTIVITY as never } } } } } },
    });
    return partners
      .filter((p) => !opts.districtName || p.coverageDistricts.length === 0 || p.coverageDistricts.includes(opts.districtName))
      .filter((p) => !opts.expertise || p.expertiseAreas.length === 0 || p.expertiseAreas.includes(opts.expertise))
      .map((p) => ({ ...this.shape(p), openActivities: p._count.activities }));
  }
}
