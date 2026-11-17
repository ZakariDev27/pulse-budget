import type { Db } from '../db.js';
import { notFound } from '../errors.js';
import { publish } from '../events.js';

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  monthlyBudgetCents: number;
}

export interface CategoryInput {
  name: string;
  kind: 'expense' | 'income';
  monthlyBudgetCents: number;
}

const COLUMNS = `id, name, kind, monthly_budget_cents as "monthlyBudgetCents"`;

export async function listCategories(db: Db): Promise<Category[]> {
  const { rows } = await db.query<Category>(
    `select ${COLUMNS} from categories order by kind, lower(name)`,
  );
  return rows;
}

export async function createCategory(db: Db, input: CategoryInput): Promise<Category> {
  const { rows } = await db.query<Category>(
    `insert into categories (name, kind, monthly_budget_cents)
     values ($1, $2, $3) returning ${COLUMNS}`,
    [input.name, input.kind, input.monthlyBudgetCents],
  );
  await publish(db, 'data.changed', { entity: 'category' });
  return rows[0]!;
}

export async function updateCategory(
  db: Db,
  id: string,
  patch: Partial<Pick<CategoryInput, 'name' | 'monthlyBudgetCents'>>,
): Promise<Category> {
  const { rows } = await db.query<Category>(
    `update categories
        set name = coalesce($2, name),
            monthly_budget_cents = coalesce($3, monthly_budget_cents)
      where id = $1 returning ${COLUMNS}`,
    [id, patch.name ?? null, patch.monthlyBudgetCents ?? null],
  );
  if (!rows[0]) throw notFound('Category');
  await publish(db, 'data.changed', { entity: 'category' });
  return rows[0];
}

export async function deleteCategory(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('delete from categories where id = $1', [id]);
  if (!rowCount) throw notFound('Category');
  await publish(db, 'data.changed', { entity: 'category' });
}
