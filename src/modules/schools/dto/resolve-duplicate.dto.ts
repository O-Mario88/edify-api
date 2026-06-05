import { IsIn } from 'class-validator';

export class ResolveDuplicateDto {
  @IsIn(['not_duplicate', 'merged', 'archived'])
  resolution!: 'not_duplicate' | 'merged' | 'archived';
}
