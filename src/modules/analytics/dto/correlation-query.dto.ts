import { IsIn, IsOptional, IsString } from 'class-validator';

const SUPPORT_FILTERS = ['all', 'staff', 'partner', 'certified_partner', 'visit', 'training', 'project'];

// Shared query for the Layer-3 correlation endpoints (support-before-ssa,
// support-ssa-correlation, staff-vs-partner-correlation).
export class CorrelationQueryDto {
  @IsOptional() @IsString() currentFy?: string;
  @IsOptional() @IsString() prevFy?: string;
  @IsOptional() @IsString() schoolType?: string;
  @IsOptional() @IsString() regionId?: string;
  @IsOptional() @IsString() districtId?: string;
  @IsOptional() @IsString() clusterId?: string;
  // Which support variable becomes X in the correlation.
  @IsOptional() @IsIn(SUPPORT_FILTERS) support?: 'all' | 'staff' | 'partner' | 'certified_partner' | 'visit' | 'training' | 'project';
}
