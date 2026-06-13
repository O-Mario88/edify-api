import { IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { SchoolType } from '@prisma/client';

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

  /** Client (default) | Core | Champion | the potential_* proposal states. Set
   *  from the upload template's School Type column; editable later. */
  @IsOptional()
  @IsEnum(SchoolType)
  schoolType?: SchoolType;

  /** Account owner as entered. Matched to a staff profile after upload. */
  @IsOptional()
  @IsString()
  accountOwnerName?: string;
}

export class SetSchoolTypeDto {
  @IsEnum(SchoolType)
  schoolType!: SchoolType;
}
