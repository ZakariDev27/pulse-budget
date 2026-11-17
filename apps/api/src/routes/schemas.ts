import { z } from 'zod';
import { isIsoDate } from '../domain/dates.js';
import { CADENCES } from '../domain/recurrence.js';

export const id = z.uuid();
export const idParams = z.object({ id });
export const isoDate = z.string().refine(isIsoDate, 'must be a valid date in YYYY-MM-DD format');
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be in YYYY-MM format');
/** Up to one billion dollars per entry. */
export const cents = z.number().int().positive().max(100_000_000_000);
export const kind = z.enum(['expense', 'income']);
export const cadence = z.enum(CADENCES);
export const text = (max: number) => z.string().trim().min(1).max(max);
export const limit = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
