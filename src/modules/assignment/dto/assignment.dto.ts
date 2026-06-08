import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AssignmentOptionsQueryDto {
  @IsString() schoolId!: string; // external schoolId
  @IsOptional() @IsString() activityType?: string;
  @IsOptional() @IsString() fy?: string;
}

export class CapacityQueryDto {
  @IsOptional() @IsString() staffId?: string; // omit → self
  @IsOptional() @IsString() fy?: string;
}

export class SetCapacityDto {
  @IsString() staffId!: string;
  @IsString() fy!: string;
  @Type(() => Number) @IsInt() @Min(0) maxDirectSchoolsSupported!: number;
  @IsOptional() @IsString() notes?: string;
}
