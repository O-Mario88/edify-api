import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { SsaIntervention } from '@prisma/client';

export class SsaScoreInput {
  @IsEnum(SsaIntervention)
  intervention!: SsaIntervention;

  @IsNumber()
  @Min(0)
  @Max(10)
  score!: number;
}

export class UploadSsaDto {
  @IsString()
  schoolId!: string; // operational schoolId

  @IsDateString()
  dateOfSsa!: string;

  @IsOptional()
  @IsInt()
  newEnrollment?: number;

  // 'partner' for partner-collected SSA (lands `pending` for staff/IA review).
  // Omitted/'staff' = staff/IA-collected, auto-verified.
  @IsOptional()
  @IsIn(['staff', 'partner'])
  collectorType?: string;

  @IsArray()
  @ArrayMinSize(8)
  @ValidateNested({ each: true })
  @Type(() => SsaScoreInput)
  scores!: SsaScoreInput[];
}
