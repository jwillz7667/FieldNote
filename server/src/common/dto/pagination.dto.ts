import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Cursor pagination — stable ordering under inserts (handoff scalability rules). */
export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor: the id of the last item from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class PaginatedDto<T> {
  @ApiProperty({ isArray: true })
  items!: T[];

  @ApiPropertyOptional({ nullable: true, description: 'Cursor for the next page, or null at the end.' })
  nextCursor!: string | null;
}
