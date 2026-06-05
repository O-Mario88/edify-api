import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { EdifyRole } from '@prisma/client';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  /** Optional role to activate at login (must be one the user holds). */
  @IsOptional()
  @IsString()
  activeRole?: EdifyRole;
}
