import { IsOptional, IsString } from 'class-validator';

export class LeadershipQueryDto {
  @IsOptional() @IsString() fy?: string;
  @IsOptional() @IsString() decisionType?: string;
  @IsOptional() @IsString() riskLevel?: string;
  @IsOptional() @IsString() confidenceLevel?: string;
  @IsOptional() @IsString() scopeType?: string;
  @IsOptional() @IsString() scopeId?: string;
  @IsOptional() @IsString() status?: string;
}

export class ReviewDecisionDto {
  @IsString() status!: string; // under_review | accepted | accepted_with_conditions | rejected | deferred | converted_to_action_plan
  @IsOptional() @IsString() note?: string;
}

export class DecisionNoteDto {
  @IsString() note!: string;
  @IsOptional() @IsString() kind?: string; // note | follow_up | condition
}

export class RecomputeDto {
  @IsOptional() @IsString() fy?: string;
}
