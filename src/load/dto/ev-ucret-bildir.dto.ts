import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class EvUcretBildirDto {
  @IsString() @MinLength(3) @MaxLength(300) dekont!: string; // havale dekont no / aciklama
  @IsOptional() @IsString() @MaxLength(300) not?: string;
}