import { Injectable } from '@nestjs/common';
import { EdifyRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { permissionsForRole, PermissionKey, PERMISSIONS } from '../rbac/permissions';
import { AuthUser } from '../auth/auth-user';

// The resolved data-access scope for a user+role. EVERY query that returns
// operational records must be constrained by this — never return all rows and
// filter on the client.
export interface UserScope {
  userId: string;
  activeRole: EdifyRole;
  permissions: PermissionKey[];
  countryScope: boolean; // sees the whole country
  regionIds: string[];
  districtIds: string[];
  clusterIds: string[];
  schoolIds: string[];
  staffIds: string[];
  supervisedStaffIds: string[];
  partnerIds: string[];
  canViewSummaryOnly: boolean;
  canViewSchoolLevelDetail: boolean;
  canViewPartnerData: boolean;
  canViewFinancialData: boolean;
  canApprove: boolean;
  canAssign: boolean;
  canExport: boolean;
}

const COUNTRY_ROLES: EdifyRole[] = ['CountryDirector', 'ImpactAssessment', 'ProgramAccountant', 'Admin'];
const SUMMARY_ONLY_ROLES: EdifyRole[] = ['RegionalVicePresident'];

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveUserScope(user: AuthUser): Promise<UserScope> {
    const role = user.activeRole;
    const perms = permissionsForRole(role);
    const has = (p: PermissionKey) => perms.includes(p);

    const countryScope = COUNTRY_ROLES.includes(role);
    const summaryOnly = SUMMARY_ONLY_ROLES.includes(role);

    let schoolIds: string[] = [];
    let districtIds: string[] = [];
    let regionIds: string[] = [];
    let clusterIds: string[] = [];
    let supervisedStaffIds: string[] = [];
    let partnerIds: string[] = [];

    const staffId = user.staffProfileId;

    if (countryScope || summaryOnly) {
      // Country-wide / summary roles are not row-constrained by geography here;
      // the repositories treat empty arrays + countryScope=true as "all".
    } else if ((role === 'CCEO' || role === 'CountryProgramLead') && staffId) {
      // Own assigned schools + (for PL) supervised staff's schools.
      const ownSchools = await this.prisma.staffSchoolAssignment.findMany({
        where: { staffId },
        select: { schoolId: true },
      });
      schoolIds = ownSchools.map((s) => s.schoolId);

      if (role === 'CountryProgramLead') {
        const supervisees = await this.prisma.staffSupervisorAssignment.findMany({
          where: { supervisorId: staffId },
          select: { superviseeId: true },
        });
        supervisedStaffIds = supervisees.map((s) => s.superviseeId);
        if (supervisedStaffIds.length) {
          const teamSchools = await this.prisma.staffSchoolAssignment.findMany({
            where: { staffId: { in: supervisedStaffIds } },
            select: { schoolId: true },
          });
          schoolIds = Array.from(new Set([...schoolIds, ...teamSchools.map((s) => s.schoolId)]));
        }
      }

      // Derive the geography + clusters from the in-scope schools.
      if (schoolIds.length) {
        const schools = await this.prisma.school.findMany({
          where: { id: { in: schoolIds } },
          select: { districtId: true, regionId: true, clusterId: true },
        });
        districtIds = uniq(schools.map((s) => s.districtId));
        regionIds = uniq(schools.map((s) => s.regionId));
        clusterIds = uniq(schools.map((s) => s.clusterId).filter((x): x is string => !!x));
      }
    } else if ((role === 'PartnerAdmin' || role === 'PartnerFieldOfficer')) {
      // Partner users see only their own partner's activities. Partner identity
      // resolution is wired when partner-user linkage lands; empty for now.
      partnerIds = [];
    }

    return {
      userId: user.userId,
      activeRole: role,
      permissions: perms,
      countryScope,
      regionIds,
      districtIds,
      clusterIds,
      schoolIds,
      staffIds: staffId ? [staffId] : [],
      supervisedStaffIds,
      partnerIds,
      canViewSummaryOnly: summaryOnly,
      canViewSchoolLevelDetail: !summaryOnly,
      canViewPartnerData: has(PERMISSIONS.PARTNER_VIEW),
      canViewFinancialData: has(PERMISSIONS.BUDGET_VIEW_DETAIL) || has(PERMISSIONS.PAYMENT_ACT),
      canApprove: has(PERMISSIONS.BUDGET_APPROVE) || has(PERMISSIONS.IA_VERIFY),
      canAssign: has(PERMISSIONS.ACTIVITY_ASSIGN),
      canExport: has(PERMISSIONS.EXPORT),
    };
  }

  /** Prisma `where` fragment that constrains School queries to the scope. */
  schoolWhere(scope: UserScope): { id?: { in: string[] } } {
    if (scope.countryScope || scope.canViewSummaryOnly) return {};
    return { id: { in: scope.schoolIds.length ? scope.schoolIds : ['__none__'] } };
  }
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
