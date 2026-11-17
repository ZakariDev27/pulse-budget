import type pg from 'pg';
import { withTransaction, type Db } from '../db.js';
import type { IsoDate } from '../domain/dates.js';
import { notFound } from '../errors.js';
import { publish } from '../events.js';
import { evaluateBudgetAlerts } from './alerts.js';

export interface Transaction {
  id: string;
  occurredOn: IsoDate;
  description: string;
  amountCents: number;
  kind: 'expense' | 'income';
  categoryId: string | null;
  source: 'manual' | 'recurring' | 'import';
  createdAt: string;
}

export interface TransactionInput {
  occurredOn: IsoDate;
  description: string;
  amountCents: number;
  kind: 'expense' | 'income';
  categoryId: string | null;
}

export interface TransactionFilter {
  /** 'YYYY-MM' */
  month?: string;
  categoryId?: string;
  limit: number;
}

const COLUMNS = `id, occurred_on as "occurredOn", description, amount_cents as "amountCents",
  kind, category_id as "categoryId", source, created_at as "createdAt"`;

export async function listTransactions(db: Db, filter: TransactionFilter): Promise<Transaction[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.month) {
    params.push(`${filter.month}-01`);
    where.push(
      `occurred_on >= $${params.length}::date and occurred_on < $${params.length}::date + interval '1 month'`,
    );
  }
  if (filter.categoryId) {
    params.push(filter.categoryId);
    where.push(`category_id = $${params.length}`);
  }
  params.push(filter.limit);
  const { rows } = await db.query<Transaction>(
    `select ${COLUMNS} from transactions
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by occurred_on desc, created_at desc
      limit $${params.length}`,
    params,
  );
  return rows;
}

export async function createTransaction(
  pool: pg.Pool,
  input: TransactionInput,
): Promise<Transaction> {
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<Transaction>(
      `insert into transactions (occurred_on, description, amount_cents, kind, category_id)
       values ($1, $2, $3, $4, $5) returning ${COLUMNS}`,
      [input.occurredOn, input.description, input.amountCents, input.kind, input.categoryId],
    );
    const created = rows[0]!;
    await evaluateBudgetAlerts(tx, created.categoryId, created.occurredOn);
    await publish(tx, 'transaction.changed', { action: 'created', id: created.id });
    return created;
  });
}

export async function updateTransaction(
  pool: pg.Pool,
  id: string,
  patch: Partial<TransactionInput>,
): Promise<Transaction> {
  return withTransaction(pool, async (tx) => {
    const { rows } = await tx.query<Transaction>(
      `update transactions
          set occurred_on  = coalesce($2, occurred_on),
              description  = coalesce($3, description),
              amount_cents = coalesce($4, amount_cents),
              kind         = coalesce($5, kind),
              category_id  = case when $6 then $7 else category_id end
        where id = $1 returning ${COLUMNS}`,
      [
        id,
        patch.occurredOn ?? null,
        patch.description ?? null,
        patch.amountCents ?? null,
        patch.kind ?? null,
        // categoryId may be set to null on purpose, so "absent" needs its own flag.
        patch.categoryId !== undefined,
        patch.categoryId ?? null,
      ],
    );
    const updated = rows[0];
    if (!updated) throw notFound('Transaction');
    await evaluateBudgetAlerts(tx, updated.categoryId, updated.occurredOn);
    await publish(tx, 'transaction.changed', { action: 'updated', id });
    return updated;
  });
}

export async function deleteTransaction(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('delete from transactions where id = $1', [id]);
  if (!rowCount) throw notFound('Transaction');
  await publish(db, 'transaction.changed', { action: 'deleted', id });
}
