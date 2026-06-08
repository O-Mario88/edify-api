import { IsIn, IsOptional, IsString } from 'class-validator';
import { SsaGroupBy } from '../analytics.service';

const GROUPS: SsaGroupBy[] = ['region', 'district', 'subCounty', 'cluster', 'cceo'];

export class SsaPerformanceQueryDto {
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsIn(GROUPS) groupBy?: SsaGroupBy;
  @IsOptional() @IsIn(['all', 'client', 'core', 'potential_core']) schoolType?: string;
  @IsOptional() @IsString() regionId?: string;
  @IsOptional() @IsString() districtId?: string;
  @IsOptional() @IsString() clusterId?: string;
}

export class SsaDrilldownQueryDto {
  @IsIn(GROUPS) groupBy!: SsaGroupBy;
  @IsString() groupId!: string;
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsIn(['all', 'client', 'core', 'potential_core']) schoolType?: string;
}
