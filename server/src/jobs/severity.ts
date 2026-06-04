import { Severity } from '@prisma/client';

/** Wire contract for severity is lowercase (handoff §1/§8); Postgres stores the enum uppercase. */
export const API_SEVERITIES = ['info', 'maintenance', 'repair', 'safety'] as const;
export type ApiSeverity = (typeof API_SEVERITIES)[number];

const TO_API: Record<Severity, ApiSeverity> = {
  INFO: 'info',
  MAINTENANCE: 'maintenance',
  REPAIR: 'repair',
  SAFETY: 'safety',
};

const FROM_API: Record<ApiSeverity, Severity> = {
  info: 'INFO',
  maintenance: 'MAINTENANCE',
  repair: 'REPAIR',
  safety: 'SAFETY',
};

export function severityToApi(severity: Severity): ApiSeverity {
  return TO_API[severity];
}

export function severityFromApi(value: ApiSeverity): Severity {
  return FROM_API[value];
}
