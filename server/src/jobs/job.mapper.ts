import { Prisma } from '@prisma/client';
import { JobDto, SectionDto } from './dto/job-response.dto';
import { severityToApi } from './severity';

/** A job loaded with its full report tree. */
export type JobWithReport = Prisma.JobGetPayload<{
  include: { sections: { include: { findings: true } } };
}>;

export const JOB_REPORT_INCLUDE = {
  sections: {
    orderBy: { sortOrder: 'asc' },
    include: { findings: { orderBy: { sortOrder: 'asc' } } },
  },
} satisfies Prisma.JobInclude;

export function jobToDto(job: JobWithReport, pdfUrl: string | null): JobDto {
  const sections: SectionDto[] = [...job.sections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section) => ({
      id: section.id,
      title: section.title,
      sortOrder: section.sortOrder,
      findings: [...section.findings]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((finding) => ({
          id: finding.id,
          text: finding.text,
          severity: severityToApi(finding.severity),
          sortOrder: finding.sortOrder,
        })),
    }));

  return {
    id: job.id,
    label: job.label,
    status: job.status,
    transcript: job.transcript,
    errorMessage: job.errorMessage,
    sections,
    pdfUrl,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
