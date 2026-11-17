import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { isIsoDate, makeDate, type IsoDate } from './dates.js';

export interface ParsedRow {
  occurredOn: IsoDate;
  description: string;
  amountCents: number;
  kind: 'expense' | 'income';
  /** Stable fingerprint used to skip rows that were already imported. */
  hash: string;
}

export interface RowError {
  row: number;
  reason: string;
}

export interface ParsedCsv {
  rows: ParsedRow[];
  errors: RowError[];
}

export interface ParseOptions {
  /** Credit-card exports list charges as positive numbers. Default: negative means money out. */
  positiveIsExpense?: boolean;
}

const HEADERS = {
  date: ['date', 'transaction date', 'posted date', 'posting date', 'post date'],
  description: ['description', 'memo', 'payee', 'name', 'details', 'merchant'],
  amount: ['amount', 'transaction amount'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out'],
  credit: ['credit', 'deposit', 'deposits', 'money in'],
} as const;

export class CsvFormatError extends Error {}

/** Parses money text such as "-1,234.50", "$12", or "(45.00)" into signed cents without float math. */
export function parseAmountCents(raw: string): number | null {
  let text = raw.replace(/[$,\s]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD and US-style M/D/YYYY or M/D/YY. */
export function parseDate(raw: string): IsoDate | null {
  const text = raw.trim();
  let candidate: IsoDate | null = null;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (iso) {
    candidate = makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  } else if (us) {
    const year = us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    candidate = makeDate(year, Number(us[1]), Number(us[2]));
  }
  return candidate && isIsoDate(candidate) ? candidate : null;
}

function findColumn(header: string[], names: readonly string[]): number {
  return header.findIndex((cell) => names.includes(cell));
}

export function parseBankCsv(text: string, options: ParseOptions = {}): ParsedCsv {
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });
  } catch (error) {
    throw new CsvFormatError(`Could not read CSV: ${(error as Error).message}`);
  }

  const header = records[0]?.map((cell) => cell.toLowerCase());
  if (!header) throw new CsvFormatError('The file is empty.');

  const column = {
    date: findColumn(header, HEADERS.date),
    description: findColumn(header, HEADERS.description),
    amount: findColumn(header, HEADERS.amount),
    debit: findColumn(header, HEADERS.debit),
    credit: findColumn(header, HEADERS.credit),
  };
  if (column.date < 0) throw new CsvFormatError('No date column found.');
  if (column.description < 0) throw new CsvFormatError('No description column found.');
  if (column.amount < 0 && column.debit < 0 && column.credit < 0) {
    throw new CsvFormatError('No amount column found (expected Amount, or Debit and Credit).');
  }

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  // Two identical purchases on one day are legitimate, so the fingerprint includes
  // how many times the same row has appeared in this file.
  const seen = new Map<string, number>();

  records.slice(1).forEach((record, index) => {
    const row = index + 2;
    const cell = (i: number) => (i >= 0 ? (record[i] ?? '') : '');

    const occurredOn = parseDate(cell(column.date));
    if (!occurredOn)
      return errors.push({ row, reason: `Unrecognized date "${cell(column.date)}"` });

    const description = cell(column.description).replace(/\s+/g, ' ').slice(0, 140);
    if (!description) return errors.push({ row, reason: 'Missing description' });

    let signed: number | null = null;
    if (cell(column.amount)) {
      signed = parseAmountCents(cell(column.amount));
      if (signed !== null && options.positiveIsExpense) signed = -signed;
    } else if (cell(column.debit)) {
      const debit = parseAmountCents(cell(column.debit));
      signed = debit === null ? null : -Math.abs(debit);
    } else if (cell(column.credit)) {
      const credit = parseAmountCents(cell(column.credit));
      signed = credit === null ? null : Math.abs(credit);
    }
    if (signed === null) return errors.push({ row, reason: 'Missing or unreadable amount' });
    if (signed === 0) return errors.push({ row, reason: 'Zero amount' });

    const key = `${occurredOn}|${description.toLowerCase()}|${signed}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    rows.push({
      occurredOn,
      description,
      amountCents: Math.abs(signed),
      kind: signed < 0 ? 'expense' : 'income',
      hash: createHash('sha256').update(`${key}|${occurrence}`).digest('hex'),
    });
  });

  return { rows, errors };
}

export interface CategoryRule {
  pattern: string;
  categoryId: string;
}

/** Case-insensitive substring match. The longest matching pattern wins, so specific rules beat broad ones. */
export function categorize(description: string, rules: readonly CategoryRule[]): string | null {
  const haystack = description.toLowerCase();
  let best: CategoryRule | null = null;
  for (const rule of rules) {
    if (!haystack.includes(rule.pattern.toLowerCase())) continue;
    if (!best || rule.pattern.length > best.pattern.length) best = rule;
  }
  return best?.categoryId ?? null;
}
