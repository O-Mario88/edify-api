import { Injectable } from '@nestjs/common';
import { EdifyRole, Prisma } from '@prisma/client';
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
  schoolIds: string[]; // union of own + team (back-compat: all in-scope schools)
  ownSchoolIds: string[]; // schools personally assigned to the user (field work)
  teamSchoolIds: string[]; // schools of supervised staff (PL team), excludes own
  coreSchoolIds: string[]; // subset of schoolIds that are Core
  staffIds: string[];
  supervisedStaffIds: string[];
  partnerIds: string[];
  canViewSummaryOnly: boolean;
  canViewSchoolLevelDetail: boolean;
  canViewPartnerData: boolean;
  canViewFinancialData: boolean;
  canViewOwn: boolean; // has a personal field-work lens
  canViewTeam: boolean; // can see a supervised-team lens (PL / country)
  canViewCountry: boolean; // sees the whole country
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
    let ownSchoolIds: string[] = [];
    let teamSchoolIds: string[] = [];
    let coreSchoolIds: string[] = [];
    let districtIds: string[] = [];
    let regionIds: string[] = [];
    let clusterIds: string[] = [];
    let supervisedStaffIds: string[] = [];
    let partnerIds: string[] = [];

    const staffId = user.staffProfileId;

    if (summaryOnly && staffId) {
      // RVP sees summary performance — scope to assigned region(s). No
      // school-level rows (see schoolWhere); analytics get country-wide counts.
      const geo = await this.prisma.staffGeographyAssignment.findMany({ where: { staffId, regionId: { not: null } }, select: { regionId: true } });
      regionIds = uniq(geo.map((g) => g.regionId!).filter(Boolean));
    } else if (countryScope) {
      // Country roles are not row-constrained by geography here.
    } else if ((role === 'CCEO' || role === 'CountryProgramLead') && staffId) {
      // Own assigned schools (personal field work).
      const ownSchools = await this.prisma.staffSchoolAssignment.findMany({
        where: { staffId },
        select: { schoolId: true },
      });
      ownSchoolIds = uniq(ownSchools.map((s) => s.schoolId));

      // PL also supervises CCEOs — their schools form the TEAM lens (distinct
      // from own, so the three PL layers — own / team / combined — are real).
      if (role === 'CountryProgramLead') {
        const supervisees = await this.prisma.staffSupervisorAssignment.findMany({
          where: { supervisorId: staffId },
          select: { superviseeId: true },
        });
        supervisedStaffIds = uniq(supervisees.map((s) => s.superviseeId));
        if (supervisedStaffIds.length) {
          const teamSchools = await this.prisma.staffSchoolAssignment.findMany({
            where: { staffId: { in: supervisedStaffIds } },
            select: { schoolId: true },
          });
          // Team = supervised-staff schools NOT already personally owned.
          teamSchoolIds = uniq(teamSchools.map((s) => s.schoolId)).filter((id) => !ownSchoolIds.includes(id));
        }
      }

      schoolIds = uniq([...ownSchoolIds, ...teamSchoolIds]);

      // Derive the geography + clusters + core subset from the in-scope schools.
      if (schoolIds.length) {
        const schools = await this.prisma.school.findMany({
          where: { id: { in: schoolIds } },
          select: { id: true, districtId: true, regionId: true, clusterId: true, schoolType: true },
        });
        districtIds = uniq(schools.map((s) => s.districtId));
        regionIds = uniq(schools.map((s) => s.regionId));
        clusterIds = uniq(schools.map((s) => s.clusterId).filter((x): x is string => !!x));
        coreSchoolIds = schools.filter((s) => s.schoolType === 'core').map((s) => s.id);
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
      ownSchoolIds,
      teamSchoolIds,
      coreSchoolIds,
      staffIds: staffId ? [staffId] : [],
      supervisedStaffIds,
      partnerIds,
      canViewSummaryOnly: summaryOnly,
      canViewSchoolLevelDetail: !summaryOnly,
      canViewPartnerData: has(PERMISSIONS.PARTNER_VIEW),
      canViewFinancialData: has(PERMISSIONS.BUDGET_VIEW_DETAIL) || has(PERMISSIONS.PAYMENT_ACT),
      canViewOwn: ownSchoolIds.length > 0 || (!countryScope && !summaryOnly),
      canViewTeam: role === 'CountryProgramLead' || countryScope,
      canViewCountry: countryScope,
      canApprove: has(PERMISSIONS.BUDGET_APPROVE) || has(PERMISSIONS.IA_VERIFY),
      canAssign: has(PERMISSIONS.ACTIVITY_ASSIGN),
      canExport: has(PERMISSIONS.EXPORT),
    };
  }

  /** School constraint for school-LEVEL reads (list/detail). Summary-only roles
   *  (RVP) receive NO school-level rows — they use aggregate summaries only. */
  schoolWhere(scope: UserScope): Prisma.SchoolWhereInput {
    if (scope.countryScope) return {};
    if (scope.canViewSummaryOnly) return { id: { in: ['__none__'] } };
    return { id: { in: scope.schoolIds.length ? scope.schoolIds : ['__none__'] } };
  }

  /** School constraint for AGGREGATE analytics. Summary-only roles see
   *  country-wide counts (their purpose) but never row-level detail. */
  aggregateSchoolWhere(scope: UserScope): Prisma.SchoolWhereInput {
    if (scope.countryScope || scope.canViewSummaryOnly) return {};
    return { id: { in: scope.schoolIds.length ? scope.schoolIds : ['__none__'] } };
  }
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
