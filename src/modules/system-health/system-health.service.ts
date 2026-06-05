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
      this.prisma.staffProfile.count({ where: { deletedAt: null, onboardingState: 'active', supervisorLinks: { none: {} } } }),
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

    // Production must not run with mock data enabled.
    if (this.config.get('NODE_ENV') === 'production' && this.config.get<boolean>('ENABLE_MOCK_DATA')) {
      findings.push({ rule: 'mock-data-enabled-in-production', severity: 'error', count: 1, message: 'ENABLE_MOCK_DATA is true in production' });
    }

    const errors = findings.filter((f) => f.severity === 'error').length;
    const warnings = findings.filter((f) => f.severity === 'warning').length;
    return { ok: errors === 0, errors, warnings, findings };
  }
}
