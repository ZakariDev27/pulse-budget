import type pg from 'pg';
import type { Config } from '../config.js';
import { withAdvisoryLock } from '../db.js';
import type { IsoDate } from '../domain/dates.js';
import { deliverDigest, formatDigest, runDailyDigest } from './digest.js';
import { postDueRecurring } from './recurring.js';

const DAILY_LOCK = 7_203_002;

export interface DailyResult {
  /** Recurring transactions posted by this run. */
  posted: number;
  digestCreated: boolean;
  digestDelivered: boolean;
}

interface Logger {
  error(details: object, message: string): void;
}

/**
 * The daily job: post due bills and income, then write yesterday's digest.
 * Every step is idempotent, so it runs at startup, on the schedule, and on demand
 * without coordination. Returns null when another run holds the lock.
 */
export async function runDailyAutomation(
  pool: pg.Pool,
  config: Pick<Config, 'CURRENCY' | 'DIGEST_WEBHOOK_URL'>,
  today: IsoDate,
  log: Logger,
): Promise<DailyResult | null> {
  const result = await withAdvisoryLock(pool, DAILY_LOCK, async () => {
    const posted = await postDueRecurring(pool, today);
    const digest = await runDailyDigest(pool, today);

    let digestDelivered = false;
    if (digest && config.DIGEST_WEBHOOK_URL) {
      try {
        await deliverDigest(
          config.DIGEST_WEBHOOK_URL,
          formatDigest(digest.payload, config.CURRENCY),
        );
        digestDelivered = true;
      } catch (error) {
        // The digest is saved and visible in the app; a webhook outage must not fail the run.
        log.error({ err: error }, 'Digest webhook delivery failed');
      }
    }
    return { posted, digestCreated: digest !== null, digestDelivered };
  });
  return result ?? null;
}
