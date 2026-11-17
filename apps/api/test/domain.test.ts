import { describe, expect, it } from 'vitest';
import { reachedThresholds, safeToSpend } from '../src/domain/budget.js';
import {
  categorize,
  CsvFormatError,
  parseAmountCents,
  parseBankCsv,
  parseDate,
} from '../src/domain/csv.js';
import { addDays, daysBetween, isIsoDate, monthEnd, todayIn } from '../src/domain/dates.js';
import { nextOccurrence, occurrencesThrough } from '../src/domain/recurrence.js';
import { formatDigest } from '../src/services/digest.js';

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
  });

  it('resolves today in the configured zone, not the host zone', () => {
    const instant = new Date('2026-03-01T03:30:00Z');
    expect(todayIn('America/New_York', instant)).toBe('2026-02-28');
    expect(todayIn('Asia/Tokyo', instant)).toBe('2026-03-01');
  });

  it('does date math across month, year and leap boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-11-17', '2026-11-30')).toBe(13);
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
  });
});

describe('recurrence', () => {
  it('returns a month-end bill to its anchor day after a short month', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    expect(nextOccurrence('2026-12-15', 'monthly', 15)).toBe('2027-01-15');
  });

  it('handles weekly, biweekly and leap-day yearly schedules', () => {
    expect(nextOccurrence('2026-11-17', 'weekly', 17)).toBe('2026-11-24');
    expect(nextOccurrence('2026-11-17', 'biweekly', 17)).toBe('2026-12-01');
    expect(nextOccurrence('2028-02-29', 'yearly', 29)).toBe('2029-02-28');
  });

  it('lists every missed occurrence when catching up', () => {
    expect(occurrencesThrough('2026-11-01', 'weekly', 1, '2026-11-17')).toEqual([
      '2026-11-01',
      '2026-11-08',
      '2026-11-15',
    ]);
    expect(occurrencesThrough('2026-12-01', 'monthly', 1, '2026-11-17')).toEqual([]);
  });
});

describe('budget', () => {
  it('reports thresholds exactly at the boundary', () => {
    expect(reachedThresholds(7_999, 10_000)).toEqual([]);
    expect(reachedThresholds(8_000, 10_000)).toEqual([80]);
    expect(reachedThresholds(10_000, 10_000)).toEqual([80, 100]);
    expect(reachedThresholds(500, 0)).toEqual([]);
  });

  it('reserves upcoming bills before dividing what is left across remaining days', () => {
    const result = safeToSpend({
      budgetCents: 300_000,
      spentCents: 120_000,
      upcomingCents: 40_000,
      today: '2026-11-17',
      monthEnd: '2026-11-30',
    });
    expect(result).toEqual({
      remainingCents: 180_000,
      availableCents: 140_000,
      daysLeft: 14,
      perDayCents: 10_000,
    });
  });

  it('never suggests spending when over budget', () => {
    const result = safeToSpend({
      budgetCents: 100_000,
      spentCents: 130_000,
      upcomingCents: 0,
      today: '2026-11-30',
      monthEnd: '2026-11-30',
    });
    expect(result.remainingCents).toBe(-30_000);
    expect(result.perDayCents).toBe(0);
    expect(result.daysLeft).toBe(1);
  });
});

describe('csv', () => {
  it('parses money without floating point error', () => {
    expect(parseAmountCents('-1,234.56')).toBe(-123_456);
    expect(parseAmountCents('$19.9')).toBe(1_990);
    expect(parseAmountCents('(45.00)')).toBe(-4_500);
    expect(parseAmountCents('0.29')).toBe(29);
    expect(parseAmountCents('12.345')).toBeNull();
    expect(parseAmountCents('abc')).toBeNull();
  });

  it('parses ISO and US dates and rejects impossible ones', () => {
    expect(parseDate('2026-11-05')).toBe('2026-11-05');
    expect(parseDate('11/5/2026')).toBe('2026-11-05');
    expect(parseDate('1/2/26')).toBe('2026-01-02');
    expect(parseDate('13/45/2026')).toBeNull();
  });

  it('reads a signed-amount export and reports bad rows without failing the file', () => {
    const { rows, errors } = parseBankCsv(
      [
        'Date,Description,Amount',
        '11/03/2026,"TRADER JOE\'S #552, NY",-84.12',
        '11/04/2026,PAYROLL ACME,2500.00',
        'not-a-date,Mystery,-5.00',
        '11/05/2026,Free sample,0.00',
      ].join('\n'),
    );
    expect(rows).toMatchObject([
      {
        occurredOn: '2026-11-03',
        description: "TRADER JOE'S #552, NY",
        amountCents: 8_412,
        kind: 'expense',
      },
      {
        occurredOn: '2026-11-04',
        description: 'PAYROLL ACME',
        amountCents: 250_000,
        kind: 'income',
      },
    ]);
    expect(errors.map((error) => error.row)).toEqual([4, 5]);
  });

  it('reads debit/credit columns and credit-card sign conventions', () => {
    const split = parseBankCsv(
      'Posted Date,Payee,Debit,Credit\n2026-11-01,Rent,1500.00,\n2026-11-02,Refund,,20.00',
    );
    expect(split.rows.map((row) => [row.kind, row.amountCents])).toEqual([
      ['expense', 150_000],
      ['income', 2_000],
    ]);
    const card = parseBankCsv('Date,Description,Amount\n2026-11-01,Coffee,4.50', {
      positiveIsExpense: true,
    });
    expect(card.rows[0]).toMatchObject({ kind: 'expense', amountCents: 450 });
  });

  it('fingerprints rows stably while keeping identical same-day purchases distinct', () => {
    const file = 'Date,Description,Amount\n2026-11-01,Coffee,-4.50\n2026-11-01,Coffee,-4.50';
    const first = parseBankCsv(file).rows.map((row) => row.hash);
    const second = parseBankCsv(file).rows.map((row) => row.hash);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(2);
  });

  it('rejects files without the required columns', () => {
    expect(() => parseBankCsv('foo,bar\n1,2')).toThrow(CsvFormatError);
    expect(() => parseBankCsv('')).toThrow(CsvFormatError);
  });

  it('categorizes by the most specific matching rule', () => {
    const rules = [
      { pattern: 'amazon', categoryId: 'shopping' },
      { pattern: 'amazon prime', categoryId: 'subscriptions' },
    ];
    expect(categorize('AMAZON PRIME*2K4', rules)).toBe('subscriptions');
    expect(categorize('Amazon.com order', rules)).toBe('shopping');
    expect(categorize('Corner deli', rules)).toBeNull();
  });
});

describe('digest text', () => {
  it('summarizes the day, the month and what to watch', () => {
    const text = formatDigest(
      {
        date: '2026-11-16',
        yesterday: {
          spentCents: 6_250,
          transactions: 2,
          topCategories: [{ name: 'Groceries', cents: 5_000 }],
        },
        month: {
          budgetCents: 200_000,
          spentCents: 150_000,
          remainingCents: 50_000,
          safePerDayCents: 3_571,
          daysLeft: 14,
        },
        watch: [{ name: 'Dining', percent: 92 }],
      },
      'USD',
    );
    expect(text).toBe(
      [
        'Pulse daily digest for 2026-11-16',
        'Yesterday: $62.50 across 2 transactions (Groceries $50.00).',
        'Month to date: $1,500.00 of $2,000.00 budgeted, $500.00 remaining.',
        'Safe to spend: $35.71 per day for the next 14 days.',
        'Watch: Dining at 92%.',
      ].join('\n'),
    );
  });
});
