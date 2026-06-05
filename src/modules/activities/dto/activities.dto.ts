import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { ActivityType } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryActivitiesDto extends PaginationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() activityType?: string;
  @IsOptional() @IsString() schoolId?: string;
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsString() quarter?: string;
  @IsOptional() @IsString() deliveryType?: string;
}

export class CreateActivityDto {
  @IsEnum(ActivityType) activityType!: ActivityType;
  @IsOptional() @IsString() schoolId?: string;   // operational schoolId
  @IsOptional() @IsString() clusterId?: string;
  @IsString() fy!: string;
  @IsString() quarter!: string;
  @IsOptional() @IsInt() plannedMonth?: number;
  @IsOptional() @IsInt() plannedWeek?: number;
  @IsOptional() @IsString() responsibleStaffId?: string;
  @IsOptional() @IsString() assignedPartnerId?: string;
}

export class CompleteActivityDto {
  @IsString() salesforceId!: string; // SV- (visit) or TS- (training)
  @IsOptional() @IsInt() teachersAttended?: number;
  @IsOptional() @IsInt() leadersAttended?: number;
  @IsOptional() @IsInt() otherParticipants?: number;
}
