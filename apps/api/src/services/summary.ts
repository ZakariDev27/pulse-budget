import type { Db } from '../db.js';
import { safeToSpend } from '../domain/budget.js';
import { monthEnd, type IsoDate } from '../domain/dates.js';
import { upcomingExpenses, type UpcomingItem } from './recurring.js';

export interface CategorySummary {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  budgetCents: number;
  /** Expenses for an expense category, income for an income category. */
  totalCents: number;
}

export interface Summary {
  month: string;
  today: IsoDate;
  totals: {
    incomeCents: number;
    expenseCents: number;
    budgetCents: number;
    /** Budget minus expenses. Negative when over budget. */
    remainingCents: number;
    uncategorizedCents: number;
  };
  /** Present only for the current month. */
  safeToSpend: {
    perDayCents: number;
    availableCents: number;
    upcomingCents: number;
    daysLeft: number;
  } | null;
  categories: CategorySummary[];
  /** Day-to-day spending. Scheduled bills are left out so rent does not flatten the chart. */
  daily: { date: IsoDate; cents: number }[];
  upcoming: UpcomingItem[];
}

export async function getSummary(db: Db, month: string, today: IsoDate): Promise<Summary> {
  const start = `${month}-01`;
  const end = monthEnd(start);

  const [categories, totals, daily] = await Promise.all([
    db.query<CategorySummary>(
      `select c.id, c.name, c.kind, c.monthly_budget_cents as "budgetCents",
              coalesce(sum(t.amount_cents) filter (where t.kind = c.kind), 0)::bigint as "totalCents"
         from categories c
         left join transactions t
           on t.category_id = c.id and t.occurred_on between $1 and $2
        group by c.id
        order by c.kind, lower(c.name)`,
      [start, end],
    ),
    db.query<{ incomeCents: number; expenseCents: number; uncategorizedCents: number }>(
      `select coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::bigint as "incomeCents",
              coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::bigint as "expenseCents",
              coalesce(sum(amount_cents) filter (where kind = 'expense' and category_id is null), 0)::bigint
                as "uncategorizedCents"
         from transactions
        where occurred_on between $1 and $2`,
      [start, end],
    ),
    db.query<{ date: IsoDate; cents: number }>(
      `select day::date as date, coalesce(sum(t.amount_cents), 0)::bigint as cents
         from generate_series($1::date, $2::date, interval '1 day') as day
         left join transactions t
           on t.occurred_on = day::date and t.kind = 'expense' and t.source <> 'recurring'
        group by day
        order by day`,
      [start, end],
    ),
  ]);

  const { incomeCents, expenseCents, uncategorizedCents } = totals.rows[0]!;
  const budgetCents = categories.rows
    .filter((category) => category.kind === 'expense')
    .reduce((sum, category) => sum + category.budgetCents, 0);

  const isCurrentMonth = today.startsWith(month);
  const upcoming = isCurrentMonth ? await upcomingExpenses(db, end) : [];
  const upcomingCents = upcoming.reduce((sum, item) => sum + item.amountCents, 0);
  const safe = safeToSpend({
    budgetCents,
    spentCents: expenseCents,
    upcomingCents,
    today,
    monthEnd: end,
  });

  return {
    month,
    today,
    totals: {
      incomeCents,
      expenseCents,
      budgetCents,
      remainingCents: safe.remainingCents,
      uncategorizedCents,
    },
    safeToSpend:
      isCurrentMonth && budgetCents > 0
        ? {
            perDayCents: safe.perDayCents,
            availableCents: safe.availableCents,
            upcomingCents,
            daysLeft: safe.daysLeft,
          }
        : null,
    categories: categories.rows,
    daily: daily.rows,
    upcoming,
  };
}
