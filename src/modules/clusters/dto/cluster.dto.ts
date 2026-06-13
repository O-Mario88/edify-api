import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ClusterType } from '@prisma/client';

export class CreateClusterDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() regionId!: string;
  @IsString() districtId!: string;
  /** A cluster covers ONE OR MORE sub-counties (§4/§5). The first is the
   *  primary (kept on Cluster.subCountyId). Prefer this over `subCountyId`. */
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsString({ each: true }) subCountyIds?: string[];
  /** Single sub-county (back-compat / from-school). Used if subCountyIds absent. */
  @IsOptional() @IsString() subCountyId?: string;
  @IsOptional() @IsString() clusterLeaderName?: string;
  @IsOptional() @IsString() clusterLeaderPhone?: string;
  @IsOptional() @IsEnum(ClusterType) clusterType?: ClusterType;
  @IsOptional() @IsString() responsibleStaffId?: string;
  /** Required to create a 2nd cluster in a sub-county (needs CLUSTER_OVERRIDE). */
  @IsOptional() @IsString() overrideReason?: string;
}

export class CreateClusterFromSchoolDto {
  @IsString() schoolId!: string;
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsEnum(ClusterType) clusterType?: ClusterType;
  @IsOptional() @IsString() overrideReason?: string;
}

export class AssignClusterDto {
  @IsString() schoolId!: string;
  @IsString() clusterId!: string;
  @IsOptional() @IsString() reason?: string;
}

// Body for POST /schools/:schoolId/cluster (schoolId comes from the path).
export class SchoolClusterBodyDto {
  @IsString() clusterId!: string;
  @IsOptional() @IsString() reason?: string;
}
