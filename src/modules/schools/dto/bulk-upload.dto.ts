import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CreateSchoolDto } from './create-school.dto';

// Bulk (CSV/Excel-derived) upload. The client parses the file to rows; this
// endpoint validates, dedupe-checks, owner-maps and tracks the batch.
export class BulkUploadDto {
  @IsOptional()
  @IsString()
  fileName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSchoolDto)
  rows!: CreateSchoolDto[];
}
