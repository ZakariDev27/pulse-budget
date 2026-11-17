import pg from 'pg';

// Dates stay 'YYYY-MM-DD' strings: converting to JS Date would shift them across time zones.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
// Cents fit comfortably inside Number.MAX_SAFE_INTEGER (about 90 trillion dollars).
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Db = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

export async function withTransaction<T>(
  pool: pg.Pool,
  work: (tx: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs `work` only if no other process holds the same advisory lock.
 * Returns undefined when the lock is taken, so overlapping runs skip instead of queueing.
 */
export async function withAdvisoryLock<T>(
  pool: pg.Pool,
  key: number,
  work: () => Promise<T>,
): Promise<T | undefined> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked',
      [key],
    );
    if (!rows[0]?.locked) return undefined;
    try {
      return await work();
    } finally {
      await client.query('select pg_advisory_unlock($1)', [key]);
    }
  } finally {
    client.release();
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof pg.DatabaseError && error.code === '23505';
}

export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof pg.DatabaseError && error.code === '23503';
}
