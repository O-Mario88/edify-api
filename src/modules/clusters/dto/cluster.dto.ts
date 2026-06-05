import { IsString, MinLength } from 'class-validator';

export class CreateClusterDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() regionId!: string;
  @IsString() districtId!: string;
}

export class AssignClusterDto {
  @IsString() schoolId!: string;
  @IsString() clusterId!: string;
}
