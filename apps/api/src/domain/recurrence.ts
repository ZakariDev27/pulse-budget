import { addDays, daysInMonth, makeDate, type IsoDate } from './dates.js';

export const CADENCES = ['weekly', 'biweekly', 'monthly', 'yearly'] as const;
export type Cadence = (typeof CADENCES)[number];

/**
 * The occurrence after `date`.
 *
 * `anchorDay` is the day of month the schedule was created for. Monthly and yearly
 * schedules clamp to the last day of short months and then return to the anchor,
 * so a bill due on the 31st posts Jan 31, Feb 28, Mar 31.
 */
export function nextOccurrence(date: IsoDate, cadence: Cadence, anchorDay: number): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));

  switch (cadence) {
    case 'weekly':
      return addDays(date, 7);
    case 'biweekly':
      return addDays(date, 14);
    case 'monthly': {
      const nextYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;
      return makeDate(nextYear, nextMonth, Math.min(anchorDay, daysInMonth(nextYear, nextMonth)));
    }
    case 'yearly':
      return makeDate(year + 1, month, Math.min(anchorDay, daysInMonth(year + 1, month)));
  }
}

/** Every occurrence from `next` up to and including `through`, capped to guard against runaway loops. */
export function occurrencesThrough(
  next: IsoDate,
  cadence: Cadence,
  anchorDay: number,
  through: IsoDate,
  limit = 400,
): IsoDate[] {
  const dates: IsoDate[] = [];
  let cursor = next;
  while (cursor <= through && dates.length < limit) {
    dates.push(cursor);
    cursor = nextOccurrence(cursor, cadence, anchorDay);
  }
  return dates;
}
