import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// A plan activity draft (plan-as-list row).
export class DraftActivityDto {
  @IsString() kind!: string;
  @IsString() title!: string;
  @IsOptional() @IsInt() weekOfMonth?: number;
  @IsOptional() @IsString() scheduledDate?: string;
  @IsOptional() @IsString() schoolId?: string;
  @IsOptional() @IsInt() @Min(0) estCostCents?: number;
  @IsOptional() @IsString() interventionArea?: string;
  @IsOptional() @IsString() deliveryType?: string;
  @IsOptional() @IsString() partnerName?: string;
}

export class CreatePlanDto {
  @IsString() monthIso!: string; // "2026-05"
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DraftActivityDto)
  activities?: DraftActivityDto[];
}

export class ReturnPlanDto {
  @IsString() reason!: string;
}
