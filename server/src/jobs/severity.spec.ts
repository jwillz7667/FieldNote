import { Severity } from '@prisma/client';
import { API_SEVERITIES, severityFromApi, severityToApi } from './severity';

describe('severity mapping', () => {
  it('exposes the four API severities in increasing-severity order', () => {
    expect(API_SEVERITIES).toEqual(['info', 'maintenance', 'repair', 'safety']);
  });

  it('maps every Prisma enum value to its lowercase wire form', () => {
    const prismaValues: Severity[] = ['INFO', 'MAINTENANCE', 'REPAIR', 'SAFETY'];
    expect(prismaValues.map(severityToApi)).toEqual(['info', 'maintenance', 'repair', 'safety']);
  });

  it('maps every wire value back to its Prisma enum form', () => {
    expect(API_SEVERITIES.map(severityFromApi)).toEqual(['INFO', 'MAINTENANCE', 'REPAIR', 'SAFETY']);
  });

  it('round-trips Prisma → API → Prisma without loss', () => {
    const prismaValues: Severity[] = ['INFO', 'MAINTENANCE', 'REPAIR', 'SAFETY'];
    for (const value of prismaValues) {
      expect(severityFromApi(severityToApi(value))).toBe(value);
    }
  });
});
