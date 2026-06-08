import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AssignmentService } from '../assignment/assignment.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';

// Targets by Time Period — staff vs partner, cumulative Q1 → Mid-Year → EoY.
// Targets prove EXECUTION (was the planned number of schools reached on time?).
// Distinct from SSA impact, which proves school improvement.
//
//   Staff Target  = CD/IA-set direct-support limit.
//   Partner Target = remaining portfolio schools after the staff target.
//   Total Target   = staff + partner (= the staff's portfolio).
//   Achieved       = UNIQUE schools reached via completed/IA-verified activities,
//                    cumulatively through the period (partner-delivered never
//                    counts toward staff, and vice-versa).

const DONE = ['completed', 'ia_verified', 'accountant_confirmed'];

const PERIODS: { label: string; quarters: string[]; pct: number }[] = [
  { label: 'Q1', quarters: ['Q1'], pct: 0.25 },
  { label: 'Q2', quarters: ['Q1', 'Q2'], pct: 0.5 },
  { label: 'Mid-Year', quarters: ['Q1', 'Q2'], pct: 0.5 },
  { label: 'Q3', quarters: ['Q1', 'Q2', 'Q3'], pct: 0.75 },
  { label: 'Q4', quarters: ['Q1', 'Q2', 'Q3', 'Q4'], pct: 1.0 },
  { label: 'End of Year', quarters: ['Q1', 'Q2', 'Q3', 'Q4'], pct: 1.0 },
];

function pct(achieved: number, target: number): number | null {
  return target > 0 ? Math.round((achieved / target) * 100) : null;
}
function statusOf(p: number | null): string {
  if (p === null) return 'No Target';
  if (p >= 100) return 'Ahead';
  if (p >= 90) return 'On Track';
  if (p >= 75) return 'Slightly Behind';
  if (p >= 50) return 'Behind';
  return 'Critical';
}

@Injectable()
export class TargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly assignment: AssignmentService,
  ) {}

  // Who the caller may view: self always; PL → supervised CCEOs; country roles → any.
  private async resolveStaffId(user: AuthUser, requested?: string): Promise<string> {
    const self = user.staffProfileId ?? '';
    if (!requested || requested === self) return self;
    const scope = await this.scope.resolveUserScope(user);
    if (scope.countryScope) return requested;
    if (user.activeRole === 'CountryProgramLead' && scope.supervisedStaffIds.includes(requested)) return requested;
    throw new ForbiddenException('You may only view your own targets.');
  }

  async timePeriod(user: AuthUser, params: { fy?: string; staffId?: string }) {
    const fy = params.fy ?? getOperationalFY();
    const staffId = await this.resolveStaffId(user, params.staffId);

    const annualStaff = await this.assignment.limitFor(staffId, fy);
    const portfolio = (await this.prisma.staffSchoolAssignment.findMany({ where: { staffId }, select: { schoolId: true } })).map((s) => s.schoolId);
    const portfolioSet = new Set(portfolio);
    const totalPortfolio = portfolioSet.size;
    const annualStaffTarget = Math.min(annualStaff, totalPortfolio || annualStaff);
    const annualPartner = Math.max(0, totalPortfolio - annualStaffTarget);

    const acts = await this.prisma.activity.findMany({
      where: {
        deletedAt: null, fy, status: { in: DONE as never },
        OR: [
          { responsibleStaffId: staffId, deliveryType: 'staff' },
          { schoolId: { in: portfolio.length ? portfolio : ['__none__'] }, deliveryType: 'partner' },
        ],
      },
      select: { schoolId: true, quarter: true, deliveryType: true },
    });

    const rows = PERIODS.map((p) => {
      const inP = acts.filter((a) => p.quarters.includes(a.quarter) && a.schoolId);
      const staffSchools = new Set(inP.filter((a) => a.deliveryType === 'staff').map((a) => a.schoolId as string));
      const partnerSchools = new Set(inP.filter((a) => a.deliveryType === 'partner').map((a) => a.schoolId as string));
      const allSchools = new Set([...staffSchools, ...partnerSchools]);

      const staffTarget = Math.round(annualStaffTarget * p.pct);
      const partnerTarget = Math.round(annualPartner * p.pct);
      const totalTarget = staffTarget + partnerTarget;
      const staffAch = staffSchools.size, partnerAch = partnerSchools.size, totalAch = allSchools.size;
      const totalPct = pct(totalAch, totalTarget);

      return {
        period: p.label,
        staff: { target: staffTarget, achieved: staffAch, pct: pct(staffAch, staffTarget) },
        partner: { target: partnerTarget, achieved: partnerAch, pct: pct(partnerAch, partnerTarget) },
        total: { target: totalTarget, achieved: totalAch, pct: totalPct },
        gap: Math.max(0, totalTarget - totalAch),
        status: statusOf(totalPct),
      };
    });

    const dataQuality: string[] = [];
    if (totalPortfolio === 0) dataQuality.push('Staff has no assigned schools — targets cannot be computed.');
    return {
      fy, staffId, totalPortfolio,
      annual: { staffTarget: annualStaffTarget, partnerTarget: annualPartner, total: annualStaffTarget + annualPartner },
      rows, dataQuality,
    };
  }
}
