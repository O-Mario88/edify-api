import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
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

  @IsArray()
  @ArrayMinSize(8)
  @ValidateNested({ each: true })
  @Type(() => SsaScoreInput)
  scores!: SsaScoreInput[];
}
