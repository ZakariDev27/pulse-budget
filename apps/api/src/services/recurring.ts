import type pg from 'pg';
import { withTransaction, type Db } from '../db.js';
import { monthStart, type IsoDate } from '../domain/dates.js';
import { nextOccurrence, occurrencesThrough, type Cadence } from '../domain/recurrence.js';
import { notFound } from '../errors.js';
import { publish } from '../events.js';
import { evaluateBudgetAlerts } from './alerts.js';

export interface RecurringRule {
  id: string;
  description: string;
  amountCents: number;
  kind: 'expense' | 'income';
  categoryId: string | null;
  cadence: Cadence;
  anchorDay: number;
  nextRun: IsoDate;
  active: boolean;
  lastPostedOn: IsoDate | null;
}

export interface RecurringInput {
  description: string;
  amountCents: number;
  kind: 'expense' | 'income';
  categoryId: string | null;
  cadence: Cadence;
  startsOn: IsoDate;
}

export interface UpcomingItem {
  date: IsoDate;
  description: string;
  amountCents: number;
}

const COLUMNS = `id, description, amount_cents as "amountCents", kind, category_id as "categoryId",
  cadence, anchor_day as "anchorDay", next_run as "nextRun", active, last_posted_on as "lastPostedOn"`;

export async function listRecurring(db: Db): Promise<RecurringRule[]> {
  const { rows } = await db.query<RecurringRule>(
    `select ${COLUMNS} from recurring_rules order by active desc, next_run, lower(description)`,
  );
  return rows;
}

export async function createRecurring(db: Db, input: RecurringInput): Promise<RecurringRule> {
  const { rows } = await db.query<RecurringRule>(
    `insert into recurring_rules
       (description, amount_cents, kind, category_id, cadence, anchor_day, next_run)
     values ($1, $2, $3, $4, $5, $6, $7) returning ${COLUMNS}`,
    [
      input.description,
      input.amountCents,
      input.kind,
      input.categoryId,
      input.cadence,
      Number(input.startsOn.slice(8, 10)),
      input.startsOn,
    ],
  );
  await publish(db, 'data.changed', { entity: 'recurring' });
  return rows[0]!;
}

export async function updateRecurring(
  db: Db,
  id: string,
  patch: { active?: boolean; amountCents?: number; description?: string },
): Promise<RecurringRule> {
  const { rows } = await db.query<RecurringRule>(
    `update recurring_rules
        set active       = coalesce($2, active),
            amount_cents = coalesce($3, amount_cents),
            description  = coalesce($4, description)
      where id = $1 returning ${COLUMNS}`,
    [id, patch.active ?? null, patch.amountCents ?? null, patch.description ?? null],
  );
  if (!rows[0]) throw notFound('Recurring rule');
  await publish(db, 'data.changed', { entity: 'recurring' });
  return rows[0];
}

export async function deleteRecurring(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('delete from recurring_rules where id = $1', [id]);
  if (!rowCount) throw notFound('Recurring rule');
  await publish(db, 'data.changed', { entity: 'recurring' });
}

/**
 * Posts every occurrence due on or before `today` and advances each rule.
 *
 * Idempotent and safe to run concurrently: rows are claimed with SKIP LOCKED, and a
 * unique index on (rule, date) makes a repeated post a no-op. After downtime it
 * catches up on every missed occurrence, each on its own due date.
 */
export async function postDueRecurring(pool: pg.Pool, today: IsoDate): Promise<number> {
  return withTransaction(pool, async (tx) => {
    const { rows: due } = await tx.query<RecurringRule>(
      `select ${COLUMNS} from recurring_rules
        where active and next_run <= $1
        order by next_run
          for update skip locked`,
      [today],
    );

    let posted = 0;
    const affected = new Map<string, { categoryId: string; date: IsoDate }>();

    for (const rule of due) {
      const dates = occurrencesThrough(rule.nextRun, rule.cadence, rule.anchorDay, today);
      for (const date of dates) {
        const inserted = await tx.query(
          `insert into transactions
             (occurred_on, description, amount_cents, kind, category_id, source, recurring_rule_id)
           values ($1, $2, $3, $4, $5, 'recurring', $6)
           on conflict (recurring_rule_id, occurred_on) where recurring_rule_id is not null
           do nothing`,
          [date, rule.description, rule.amountCents, rule.kind, rule.categoryId, rule.id],
        );
        posted += inserted.rowCount ?? 0;
        if (rule.categoryId) {
          affected.set(`${rule.categoryId}|${monthStart(date)}`, {
            categoryId: rule.categoryId,
            date,
          });
        }
      }
      const last = dates.at(-1)!;
      await tx.query(
        'update recurring_rules set next_run = $2, last_posted_on = $3 where id = $1',
        [rule.id, nextOccurrence(last, rule.cadence, rule.anchorDay), last],
      );
    }

    for (const { categoryId, date } of affected.values()) {
      await evaluateBudgetAlerts(tx, categoryId, date);
    }
    if (posted > 0) await publish(tx, 'recurring.posted', { count: posted });
    return posted;
  });
}

/** Scheduled expenses that will post on or before `through`, including any that are overdue. */
export async function upcomingExpenses(db: Db, through: IsoDate): Promise<UpcomingItem[]> {
  const { rows } = await db.query<RecurringRule>(
    `select ${COLUMNS} from recurring_rules
      where active and kind = 'expense' and next_run <= $1`,
    [through],
  );
  return rows
    .flatMap((rule) =>
      occurrencesThrough(rule.nextRun, rule.cadence, rule.anchorDay, through).map((date) => ({
        date,
        description: rule.description,
        amountCents: rule.amountCents,
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
