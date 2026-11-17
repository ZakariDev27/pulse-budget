import type pg from 'pg';
import { withTransaction, type Db } from '../db.js';
import {
  categorize,
  parseBankCsv,
  type CategoryRule,
  type ParseOptions,
  type RowError,
} from '../domain/csv.js';
import { monthStart, type IsoDate } from '../domain/dates.js';
import { notFound } from '../errors.js';
import { publish } from '../events.js';
import { evaluateBudgetAlerts } from './alerts.js';

export interface ImportRule extends CategoryRule {
  id: string;
}

export interface ImportResult {
  imported: number;
  /** Rows already present from an earlier import. */
  duplicates: number;
  uncategorized: number;
  errors: RowError[];
}

export async function listImportRules(db: Db): Promise<ImportRule[]> {
  const { rows } = await db.query<ImportRule>(
    `select id, pattern, category_id as "categoryId" from import_rules order by lower(pattern)`,
  );
  return rows;
}

export async function createImportRule(db: Db, input: CategoryRule): Promise<ImportRule> {
  const { rows } = await db.query<ImportRule>(
    `insert into import_rules (pattern, category_id) values ($1, $2)
     returning id, pattern, category_id as "categoryId"`,
    [input.pattern, input.categoryId],
  );
  await publish(db, 'data.changed', { entity: 'import-rule' });
  return rows[0]!;
}

export async function deleteImportRule(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('delete from import_rules where id = $1', [id]);
  if (!rowCount) throw notFound('Import rule');
  await publish(db, 'data.changed', { entity: 'import-rule' });
}

/**
 * Imports a bank CSV in one transaction. Re-importing the same file, or an
 * overlapping date range, adds nothing: each row carries a content fingerprint.
 */
export async function importCsv(
  pool: pg.Pool,
  text: string,
  options: ParseOptions = {},
): Promise<ImportResult> {
  const { rows, errors } = parseBankCsv(text, options);

  return withTransaction(pool, async (tx) => {
    const rules = await listImportRules(tx);
    const affected = new Map<string, { categoryId: string; date: IsoDate }>();
    let imported = 0;
    let uncategorized = 0;

    for (const row of rows) {
      const categoryId = row.kind === 'expense' ? categorize(row.description, rules) : null;
      const inserted = await tx.query(
        `insert into transactions
           (occurred_on, description, amount_cents, kind, category_id, source, import_hash)
         values ($1, $2, $3, $4, $5, 'import', $6)
         on conflict (import_hash) do nothing`,
        [row.occurredOn, row.description, row.amountCents, row.kind, categoryId, row.hash],
      );
      if (!inserted.rowCount) continue;
      imported += 1;
      if (categoryId) {
        affected.set(`${categoryId}|${monthStart(row.occurredOn)}`, {
          categoryId,
          date: row.occurredOn,
        });
      } else if (row.kind === 'expense') {
        uncategorized += 1;
      }
    }

    for (const { categoryId, date } of affected.values()) {
      await evaluateBudgetAlerts(tx, categoryId, date);
    }
    const duplicates = rows.length - imported;
    if (imported > 0) await publish(tx, 'import.completed', { imported, skipped: duplicates });
    return { imported, duplicates, uncategorized, errors };
  });
}
