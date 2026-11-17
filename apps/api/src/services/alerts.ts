import type { Db } from '../db.js';
import { reachedThresholds } from '../domain/budget.js';
import { monthStart, type IsoDate } from '../domain/dates.js';
import { publish } from '../events.js';

export interface Alert {
  id: string;
  categoryId: string;
  categoryName: string;
  month: IsoDate;
  threshold: number;
  spentCents: number;
  budgetCents: number;
  createdAt: string;
}

/**
 * Checks a category's month-to-date spend against its budget and records any
 * threshold reached for the first time. Call inside the transaction that changed
 * the spend: the alert and its live event then commit, or roll back, with it.
 */
export async function evaluateBudgetAlerts(
  tx: Db,
  categoryId: string | null,
  date: IsoDate,
): Promise<void> {
  if (!categoryId) return;
  const month = monthStart(date);

  // Lock the category first so concurrent writers total the month one at a time.
  const category = await tx.query<{ name: string; budgetCents: number }>(
    `select name, monthly_budget_cents as "budgetCents"
       from categories
      where id = $1 and kind = 'expense' and monthly_budget_cents > 0
        for update`,
    [categoryId],
  );
  const found = category.rows[0];
  if (!found) return;

  const spent = await tx.query<{ spentCents: number }>(
    `select coalesce(sum(amount_cents), 0)::bigint as "spentCents"
       from transactions
      where category_id = $1 and kind = 'expense'
        and occurred_on >= $2::date and occurred_on < $2::date + interval '1 month'`,
    [categoryId, month],
  );
  const spentCents = spent.rows[0]?.spentCents ?? 0;

  for (const threshold of reachedThresholds(spentCents, found.budgetCents)) {
    const inserted = await tx.query(
      `insert into alerts (category_id, month, threshold, spent_cents, budget_cents)
       values ($1, $2, $3, $4, $5)
       on conflict (category_id, month, threshold) do nothing`,
      [categoryId, month, threshold, spentCents, found.budgetCents],
    );
    if (inserted.rowCount) {
      await publish(tx, 'budget.alert', {
        categoryId,
        categoryName: found.name,
        threshold,
        spentCents,
        budgetCents: found.budgetCents,
      });
    }
  }
}

export async function listAlerts(db: Db, limit: number): Promise<Alert[]> {
  const { rows } = await db.query<Alert>(
    `select a.id, a.category_id as "categoryId", c.name as "categoryName", a.month,
            a.threshold, a.spent_cents as "spentCents", a.budget_cents as "budgetCents",
            a.created_at as "createdAt"
       from alerts a join categories c on c.id = a.category_id
      order by a.created_at desc
      limit $1`,
    [limit],
  );
  return rows;
}
