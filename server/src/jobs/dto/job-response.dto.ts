import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatus } from '@prisma/client';
import { API_SEVERITIES, ApiSeverity } from '../severity';

export class FindingDto {
  @ApiProperty() id!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ enum: API_SEVERITIES }) severity!: ApiSeverity;
  @ApiProperty() sortOrder!: number;
}

export class SectionDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: [FindingDto] }) findings!: FindingDto[];
}

export class JobDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: JobStatus }) status!: JobStatus;
  @ApiPropertyOptional({ nullable: true }) transcript!: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'User-safe failure reason when status=FAILED.' })
  errorMessage!: string | null;
  @ApiProperty({ type: [SectionDto] }) sections!: SectionDto[];
  @ApiPropertyOptional({ nullable: true, description: 'Presigned GET URL for the PDF (present when READY).' })
  pdfUrl!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class PresignedUploadDto {
  @ApiProperty() url!: string;
  @ApiProperty() key!: string;
  @ApiProperty() contentType!: string;
  @ApiProperty() expiresInSeconds!: number;
}

export class CreateJobResponseDto {
  @ApiProperty({ type: JobDto }) job!: JobDto;
  @ApiProperty({ type: PresignedUploadDto, description: 'Presigned PUT for the audio file.' })
  audioUploadUrl!: PresignedUploadDto;
}

export class PdfUrlDto {
  @ApiProperty() url!: string;
  @ApiProperty() expiresInSeconds!: number;
}
