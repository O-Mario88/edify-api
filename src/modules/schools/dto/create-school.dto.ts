import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

// Manual single-school upload. Geography is referenced by ID (regionId/
// districtId), never free text — the School Directory is the source of truth.
export class CreateSchoolDto {
  @IsString()
  @MinLength(1)
  schoolId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  regionId!: string;

  @IsString()
  districtId!: string;

  @IsOptional()
  @IsString()
  subCountyId?: string;

  @IsOptional()
  @IsString()
  parishId?: string;

  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @IsOptional()
  @IsString()
  schoolPhone?: string;

  @IsOptional()
  @IsString()
  primaryContactName?: string;

  @IsOptional()
  @IsString()
  primaryContactPhone?: string;

  @IsOptional()
  @IsInt()
  enrollment?: number;

  /** Account owner as entered. Matched to a staff profile after upload. */
  @IsOptional()
  @IsString()
  accountOwnerName?: string;
}
