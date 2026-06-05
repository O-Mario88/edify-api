import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

export interface HealthFinding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  count: number;
  message: string;
}

// §26 system-health: catches missing setup + data problems across the workflow.
@Injectable()
export class SystemHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async report(): Promise<{ ok: boolean; errors: number; warnings: number; findings: HealthFinding[] }> {
    const findings: HealthFinding[] = [];
    const add = (rule: string, severity: HealthFinding['severity'], count: number, message: string) => {
      if (count > 0) findings.push({ rule, severity, count, message });
    };

    const [
      noOwner, noCluster, noSsa, unmatched, dupes,
      activitiesNoLink, staffNoSupervisor, staffNoPrimaryDistrict,
      paymentsNoIa,
    ] = await Promise.all([
      this.prisma.school.count({ where: { deletedAt: null, accountOwnerId: null } }),
      this.prisma.school.count({ where: { deletedAt: null, clusterId: null } }),
      this.prisma.school.count({ where: { deletedAt: null, currentFySsaStatus: 'not_done' } }),
      this.prisma.school.count({ where: { deletedAt: null, accountOwnerStatus: 'unmatched' } }),
      this.prisma.schoolDuplicateCandidate.count({ where: { resolved: false } }),
      this.prisma.activity.count({ where: { deletedAt: null, schoolId: null, clusterId: null, projectId: null } }),
      // Field staff with no supervisor — exclude top-level roles who supervise
      // others and legitimately have none (PL/CD/RVP/Admin).
      this.prisma.staffProfile.count({ where: { deletedAt: null, onboardingState: 'active', supervisorLinks: { none: {} }, superviseeLinks: { none: {} }, user: { roles: { hasSome: ['CCEO', 'ProjectCoordinator', 'PartnerFieldOfficer'] } } } }),
      this.prisma.staffProfile.count({ where: { deletedAt: null, onboardingState: 'active', primaryDistrictId: null } }),
      this.prisma.paymentRequest.count({ where: { status: 'pending_ia' } }),
    ]);

    add('schools-without-account-owner', 'warning', noOwner, 'Schools without an account owner');
    add('schools-without-cluster', 'warning', noCluster, 'Schools not assigned to a cluster');
    add('schools-missing-current-fy-ssa', 'info', noSsa, 'Schools without a current-FY SSA (planning locked)');
    add('unmatched-account-owners', 'error', unmatched, 'Uploaded schools with an unmatched account owner');
    add('unresolved-duplicate-risks', 'warning', dupes, 'Potential duplicate schools awaiting IA review');
    add('activities-without-school-or-cluster', 'error', activitiesNoLink, 'Activities not traceable to a school/cluster/project');
    add('staff-without-supervisor', 'error', staffNoSupervisor, 'Active staff with no supervisor');
    add('staff-without-primary-district', 'warning', staffNoPrimaryDistrict, 'Active staff with no primary district');
    add('payments-without-ia-confirmation', 'info', paymentsNoIa, 'Payment requests still awaiting IA confirmation');

    // ── Cluster + planning integrity (§21) ──────────────────────────
    const [clustersNoSchools, mismatch, planningReadyButUnclustered] = await Promise.all([
      this.prisma.cluster.count({ where: { deletedAt: null, schools: { none: {} } } }),
      // clustered school whose clusterId has no backing SchoolClusterAssignment
      this.prisma.school.count({ where: { deletedAt: null, clusterStatus: 'clustered', clusterId: { not: null }, clusterAssignments: { none: {} } } }),
      // inconsistency: planning-ready but not actually clustered
      this.prisma.school.count({ where: { deletedAt: null, planningReadiness: 'ready', clusterStatus: { not: 'clustered' } } }),
    ]);
    // Duplicate ACTIVE clusters in the same sub-county.
    const dupClusters = await this.prisma.cluster.groupBy({
      by: ['subCountyId'], where: { deletedAt: null, status: 'active', subCountyId: { not: null } }, _count: { _all: true }, having: { subCountyId: { _count: { gt: 1 } } },
    });
    // Sub-counties that have unclustered schools but no active cluster.
    const subsWithUnclusteredNoCluster = await this.prisma.subCounty.count({
      where: { clusters: { none: { deletedAt: null, status: 'active' } }, schools: { some: { deletedAt: null, clusterStatus: 'unclustered' } } },
    });

    add('cluster-with-no-schools', 'warning', clustersNoSchools, 'Clusters with no schools');
    add('clustered-school-without-assignment', 'error', mismatch, 'Clustered schools with no backing cluster assignment');
    add('planning-ready-but-unclustered', 'error', planningReadyButUnclustered, 'Schools marked planning-ready but not clustered (inconsistency)');
    add('duplicate-active-cluster-per-subcounty', 'error', dupClusters.length, 'Sub-counties with more than one active cluster');
    add('subcounty-unclustered-schools-no-cluster', 'info', subsWithUnclusteredNoCluster, 'Sub-counties with unclustered schools and no cluster yet');

    // Production must not run with mock data enabled.
    if (this.config.get('NODE_ENV') === 'production' && this.config.get<boolean>('ENABLE_MOCK_DATA')) {
      findings.push({ rule: 'mock-data-enabled-in-production', severity: 'error', count: 1, message: 'ENABLE_MOCK_DATA is true in production' });
    }

    const errors = findings.filter((f) => f.severity === 'error').length;
    const warnings = findings.filter((f) => f.severity === 'warning').length;
    return { ok: errors === 0, errors, warnings, findings };
  }
}
