import { IsIn, IsOptional, IsString } from 'class-validator';
import { SsaGroupBy } from '../analytics.service';

const GROUPS: SsaGroupBy[] = ['region', 'district', 'subCounty', 'cluster', 'cceo'];

// Name-based geography filter as emitted by the FE filter bar (district *name*,
// region *key* — resolved server-side via relation filters). Kept separate from
// the cuid `*Id` fields so both calling styles validate under forbidNonWhitelisted.
export class GeoFilterDto {
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() cluster?: string;
}

export class SsaPerformanceQueryDto {
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsIn(GROUPS) groupBy?: SsaGroupBy;
  @IsOptional() @IsIn(['all', 'client', 'core', 'potential_core']) schoolType?: string;
  @IsOptional() @IsString() regionId?: string;
  @IsOptional() @IsString() districtId?: string;
  @IsOptional() @IsString() clusterId?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() cluster?: string;
}

export class SsaDrilldownQueryDto {
  @IsIn(GROUPS) groupBy!: SsaGroupBy;
  @IsString() groupId!: string;
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsIn(['all', 'client', 'core', 'potential_core']) schoolType?: string;
}

export class InterventionImprovementQueryDto {
  @IsOptional() @IsIn(GROUPS) groupBy?: SsaGroupBy;
  @IsOptional() @IsIn(['all', 'client', 'core', 'potential_core']) schoolType?: string;
  @IsOptional() @IsString() currentFy?: string;
  @IsOptional() @IsString() prevFy?: string;
  @IsOptional() @IsString() regionId?: string;
  @IsOptional() @IsString() districtId?: string;
  @IsOptional() @IsString() clusterId?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() cluster?: string;
}
