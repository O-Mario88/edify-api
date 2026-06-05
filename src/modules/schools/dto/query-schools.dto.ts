import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QuerySchoolsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  regionId?: string;

  @IsOptional()
  @IsString()
  districtId?: string;

  @IsOptional()
  @IsString()
  subCountyId?: string;

  @IsOptional()
  @IsString()
  clusterId?: string;

  @IsOptional()
  @IsString()
  clusterStatus?: string; // unclustered | clustered | needs_review

  @IsOptional()
  @IsString()
  ssaStatus?: string;

  @IsOptional()
  @IsString()
  planningReadiness?: string; // locked | limited | ready

  @IsOptional()
  @IsString()
  schoolType?: string;

  @IsOptional()
  @IsString()
  duplicateStatus?: string;

  @IsOptional()
  @IsString()
  accountOwnerStatus?: string;
}
