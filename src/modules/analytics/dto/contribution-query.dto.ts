import { IsIn, IsOptional, IsString } from 'class-validator';
import { Lens, ContributionMetricKey } from '../contribution.service';

const LENSES: Lens[] = ['own', 'team', 'combined'];
const METRICS: ContributionMetricKey[] = ['schoolsReached', 'teachersTrained', 'schoolLeadersTrained', 'learnersImpacted', 'districtsCovered', 'ssaImprovement'];

export class ContributionQueryDto {
  @IsOptional() @IsIn(LENSES) lens: Lens = 'own';
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsString() quarter?: string;
  @IsOptional() @IsString() districtId?: string;
  @IsOptional() @IsString() clusterId?: string;
  @IsOptional() @IsString() schoolType?: string;
  @IsOptional() @IsString() activityType?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() partnerId?: string;
  // Name/key-based geography from the FE filter bar.
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() cluster?: string;
}

export class ContributionDrilldownDto extends ContributionQueryDto {
  @IsIn(METRICS) metric!: ContributionMetricKey;
}
