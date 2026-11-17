import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { todayIn } from '../domain/dates.js';
import { listAlerts } from '../services/alerts.js';
import { runDailyAutomation } from '../services/daily.js';
import { listDigests } from '../services/digest.js';
import { getSummary } from '../services/summary.js';
import { limit, month } from './schemas.js';

const summaryQuery = z.object({ month: month.optional() });
const feedQuery = z.object({ limit: limit(20, 100) });

export function insightRoutes(app: FastifyInstance, { pool, config, clock }: AppDeps): void {
  const today = () => todayIn(config.APP_TZ, clock());

  app.get('/api/summary', async (request) => {
    const query = summaryQuery.parse(request.query);
    const summary = await getSummary(pool, query.month ?? today().slice(0, 7), today());
    return { ...summary, currency: config.CURRENCY, timeZone: config.APP_TZ };
  });

  app.get('/api/alerts', (request) => listAlerts(pool, feedQuery.parse(request.query).limit));

  app.get('/api/digests', (request) => listDigests(pool, feedQuery.parse(request.query).limit));

  // Runs the same job the worker runs on its schedule. Idempotent.
  app.post('/api/automation/run', async (request) => {
    const result = await runDailyAutomation(pool, config, today(), request.log);
    return result ?? { skipped: true };
  });
}
