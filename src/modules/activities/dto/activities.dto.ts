import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { ActivityType, ClusterMeetingSlot } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryActivitiesDto extends PaginationDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() activityType?: string;
  @IsOptional() @IsString() schoolId?: string;
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsString() quarter?: string;
  @IsOptional() @IsString() deliveryType?: string;
  /** "true" → only the caller's own activities (My Plan). */
  @IsOptional() @IsString() mine?: string;
  /** "active" → still-actionable work (Planning / My Plan); "completed" → the
   *  Completed Activities Log (verified / paid / closed / cancelled / rejected). */
  @IsOptional() @IsString() statusGroup?: string;
}

export class RescheduleActivityDto {
  @IsString() scheduledDate!: string; // ISO date
  @IsString() reason!: string;
}

export class ReassignActivityDto {
  @IsString() deliveryType!: 'staff' | 'partner';
  @IsOptional() @IsString() assignedPartnerId?: string;
  @IsOptional() @IsString() responsibleStaffId?: string;
}

export class ReasonDto {
  @IsString() reason!: string;
}

export class CreateActivityDto {
  @IsEnum(ActivityType) activityType!: ActivityType;
  @IsOptional() @IsString() schoolId?: string;   // operational schoolId
  @IsOptional() @IsString() clusterId?: string;
  @IsString() fy!: string;
  @IsString() quarter!: string;
  @IsOptional() @IsInt() plannedMonth?: number;
  @IsOptional() @IsInt() plannedWeek?: number;
  /** Exact date (ISO) — required for date-specific work (cluster meetings,
   *  trainings, SIT). Visits may schedule by month/week only. */
  @IsOptional() @IsString() scheduledDate?: string;
  @IsOptional() @IsString() responsibleStaffId?: string;
  @IsOptional() @IsString() assignedPartnerId?: string;
  @IsOptional() @IsString() deliveryType?: 'staff' | 'partner';
  /** Explicit cluster slot: 'sit' | 'first_meeting' | 'second_meeting' | 'third_meeting'. */
  @IsOptional() @IsEnum(ClusterMeetingSlot) clusterSlot?: ClusterMeetingSlot;
}

export class CompleteActivityDto {
  @IsString() salesforceId!: string; // SV- (visit) or TS- (training)
  @IsOptional() @IsInt() teachersAttended?: number;
  @IsOptional() @IsInt() leadersAttended?: number;
  @IsOptional() @IsInt() otherParticipants?: number;
}
