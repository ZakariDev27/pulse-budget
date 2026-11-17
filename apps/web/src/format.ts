export function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

/** Whole-unit money for headline figures where cents are noise. */
export function moneyRounded(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

/** Parses user-typed money such as "1,250", "12.5" or "$8.99" into cents without float math. */
export function parseMoney(input: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.replace(/[$,\s]/g, ''));
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

const utcDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export function shortDate(iso: string): string {
  return utcDate(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function monthLabel(month: string): string {
  return utcDate(`${month}-01`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function shiftMonth(month: string, delta: number): string {
  const date = utcDate(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.floor((part * 100) / whole) : 0;
}
