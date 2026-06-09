import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Base pagination + sorting every list endpoint accepts. Prevents uncontrolled
// large dataset returns.
export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 25;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortDir?: 'asc' | 'desc';

  // `skip`/`take` are DERIVED from page/pageSize — they are not request inputs.
  // The no-op setters exist only so class-transformer doesn't crash if a client
  // sends `?take=`/`?skip=` (it tries to assign onto the instance); the incoming
  // value is intentionally ignored so pagination can't be driven out of band.
  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }
  set skip(_v: number) { /* derived — ignore inbound */ }
  get take(): number {
    return this.pageSize;
  }
  set take(_v: number) { /* derived — ignore inbound */ }
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(data: T[], total: number, dto: PaginationDto): Paginated<T> {
  return {
    data,
    page: dto.page,
    pageSize: dto.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / dto.pageSize)),
  };
}
