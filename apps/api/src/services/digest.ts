import type pg from 'pg';
import type { Db } from '../db.js';
import { addDays, type IsoDate } from '../domain/dates.js';
import { publish } from '../events.js';
import { getSummary } from './summary.js';

export interface DigestPayload {
  date: IsoDate;
  yesterday: {
    spentCents: number;
    transactions: number;
    topCategories: { name: string; cents: number }[];
  };
  month: {
    budgetCents: number;
    spentCents: number;
    remainingCents: number;
    safePerDayCents: number | null;
    daysLeft: number | null;
  };
  /** Categories at or above 80% of budget. */
  watch: { name: string; percent: number }[];
}

export interface Digest {
  id: string;
  date: IsoDate;
  payload: DigestPayload;
  createdAt: string;
}

export async function buildDigest(db: Db, today: IsoDate): Promise<DigestPayload> {
  const date = addDays(today, -1);
  const [totals, top, summary] = await Promise.all([
    db.query<{ spentCents: number; transactions: number }>(
      `select coalesce(sum(amount_cents), 0)::bigint as "spentCents", count(*)::int as transactions
         from transactions where occurred_on = $1 and kind = 'expense'`,
      [date],
    ),
    db.query<{ name: string; cents: number }>(
      `select coalesce(c.name, 'Uncategorized') as name, sum(t.amount_cents)::bigint as cents
         from transactions t left join categories c on c.id = t.category_id
        where t.occurred_on = $1 and t.kind = 'expense'
        group by 1 order by cents desc limit 3`,
      [date],
    ),
    getSummary(db, today.slice(0, 7), today),
  ]);

  return {
    date,
    yesterday: { ...totals.rows[0]!, topCategories: top.rows },
    month: {
      budgetCents: summary.totals.budgetCents,
      spentCents: summary.totals.expenseCents,
      remainingCents: summary.totals.remainingCents,
      safePerDayCents: summary.safeToSpend?.perDayCents ?? null,
      daysLeft: summary.safeToSpend?.daysLeft ?? null,
    },
    watch: summary.categories
      .filter((c) => c.kind === 'expense' && c.budgetCents > 0)
      .map((c) => ({ name: c.name, percent: Math.floor((c.totalCents * 100) / c.budgetCents) }))
      .filter((c) => c.percent >= 80)
      .sort((a, b) => b.percent - a.percent),
  };
}

export function formatDigest(payload: DigestPayload, currency: string): string {
  const money = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  const { yesterday, month, watch } = payload;

  const lines = [
    `Pulse daily digest for ${payload.date}`,
    yesterday.transactions === 0
      ? 'Yesterday: no spending.'
      : `Yesterday: ${money(yesterday.spentCents)} across ${yesterday.transactions} transaction${yesterday.transactions === 1 ? '' : 's'}` +
        (yesterday.topCategories.length
          ? ` (${yesterday.topCategories.map((c) => `${c.name} ${money(c.cents)}`).join(', ')}).`
          : '.'),
    `Month to date: ${money(month.spentCents)} of ${money(month.budgetCents)} budgeted, ` +
      (month.remainingCents >= 0
        ? `${money(month.remainingCents)} remaining.`
        : `${money(-month.remainingCents)} over budget.`),
  ];
  if (month.safePerDayCents !== null && month.daysLeft !== null) {
    lines.push(
      `Safe to spend: ${money(month.safePerDayCents)} per day for the next ${month.daysLeft} day${month.daysLeft === 1 ? '' : 's'}.`,
    );
  }
  if (watch.length) {
    lines.push(`Watch: ${watch.map((c) => `${c.name} at ${c.percent}%`).join(', ')}.`);
  }
  return lines.join('\n');
}

/** Creates yesterday's digest once. Returns null if it already exists. */
export async function runDailyDigest(pool: pg.Pool, today: IsoDate): Promise<Digest | null> {
  const payload = await buildDigest(pool, today);
  const { rows } = await pool.query<Digest>(
    `insert into digests (digest_date, payload) values ($1, $2)
     on conflict (digest_date) do nothing
     returning id, digest_date as date, payload, created_at as "createdAt"`,
    [payload.date, JSON.stringify(payload)],
  );
  const digest = rows[0] ?? null;
  if (digest) await publish(pool, 'digest.created', { date: digest.date });
  return digest;
}

export async function listDigests(db: Db, limit: number): Promise<Digest[]> {
  const { rows } = await db.query<Digest>(
    `select id, digest_date as date, payload, created_at as "createdAt"
       from digests order by digest_date desc limit $1`,
    [limit],
  );
  return rows;
}

/** Posts the digest to a Slack- or Discord-compatible incoming webhook. */
export async function deliverDigest(url: string, text: string): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Slack reads `text`, Discord reads `content`.
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Webhook responded ${response.status}`);
}
