import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthenticatedUser } from '../common/auth/authenticated-user';
import { PaginatedDto, PaginationQueryDto } from '../common/dto/pagination.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateJobResponseDto, JobDto, PdfUrlDto } from './dto/job-response.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { JobsService } from './jobs.service';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @ApiOperation({ summary: 'List the current user\'s jobs (cursor-paginated).' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedDto<JobDto>> {
    return this.jobs.list(user.userId, query.cursor, query.limit);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft job; returns the job and a presigned audio upload URL.' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'De-dupes retried creates.' })
  @ApiResponse({ status: 201, type: CreateJobResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateJobDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CreateJobResponseDto> {
    return this.jobs.create(user.userId, dto, idempotencyKey?.trim() || null);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a job with its report and (if READY) a presigned PDF URL.' })
  @ApiResponse({ status: 200, type: JobDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobDto> {
    return this.jobs.findOne(user.userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update label and/or edited report sections (last-write-wins).' })
  @ApiResponse({ status: 200, type: JobDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobDto,
  ): Promise<JobDto> {
    return this.jobs.update(user.userId, id, dto);
  }

  @Post(':id/process')
  @ApiOperation({ summary: 'Mark audio uploaded and enqueue processing (idempotent).' })
  @ApiResponse({ status: 200, type: JobDto })
  @HttpCode(HttpStatus.OK)
  process(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JobDto> {
    return this.jobs.process(user.userId, id);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Get a short-lived presigned URL for the rendered PDF.' })
  @ApiResponse({ status: 200, type: PdfUrlDto })
  pdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PdfUrlDto> {
    return this.jobs.getPdfUrl(user.userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a job and remove its R2 objects.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.jobs.remove(user.userId, id);
  }
}
