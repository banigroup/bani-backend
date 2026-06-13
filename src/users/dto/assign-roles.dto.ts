import { IsArray, ArrayNotEmpty, IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class AssignRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles!: Role[];
}
