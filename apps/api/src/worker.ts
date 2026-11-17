import { Cron } from 'croner';
import { pino } from 'pino';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { todayIn } from './domain/dates.js';
import { migrate } from './migrate.js';
import { runDailyAutomation } from './services/daily.js';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL, name: 'worker' });
const pool = createPool(config.DATABASE_URL);

async function run(trigger: 'startup' | 'schedule'): Promise<void> {
  const today = todayIn(config.APP_TZ);
  try {
    const result = await runDailyAutomation(pool, config, today, log);
    log.info({ trigger, today, ...(result ?? { skipped: true }) }, 'Daily automation finished');
  } catch (error) {
    log.error({ err: error, trigger, today }, 'Daily automation failed');
  }
}

try {
  await migrate(pool);
} catch (error) {
  log.fatal({ err: error }, 'Failed to start');
  process.exit(1);
}

// Catch up immediately: if the container was down at the scheduled time, nothing is missed.
await run('startup');

const job = new Cron(config.DAILY_CRON, { timezone: config.APP_TZ, protect: true }, () =>
  run('schedule'),
);
log.info(
  { cron: config.DAILY_CRON, timeZone: config.APP_TZ, next: job.nextRun()?.toISOString() },
  'Worker scheduled',
);

const shutdown = async (signal: string) => {
  log.info(`${signal} received, shutting down`);
  job.stop();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
