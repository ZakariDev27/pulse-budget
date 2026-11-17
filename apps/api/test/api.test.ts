import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const TOKEN = 'test-token-0123456789';
// 17:00 UTC is noon in New York, so "today" is Nov 17 there.
const NOW = new Date('2026-11-17T17:00:00Z');

describe.skipIf(!DATABASE_URL)('API (requires TEST_DATABASE_URL)', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) => {
    const response = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${TOKEN}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });
    return { status: response.statusCode, body: response.body ? response.json() : null };
  };

  const category = async (name: string, monthlyBudgetCents = 0) =>
    (await call('POST', '/api/categories', { name, monthlyBudgetCents })).body.id as string;

  const spend = (categoryId: string | null, amountCents: number, occurredOn = '2026-11-10') =>
    call('POST', '/api/transactions', { occurredOn, description: 'Test', amountCents, categoryId });

  beforeAll(async () => {
    pool = createPool(DATABASE_URL!);
    await pool.query('drop schema public cascade; create schema public');
    await migrate(pool);
    const config = loadConfig({
      DATABASE_URL,
      API_TOKEN: TOKEN,
      LOG_LEVEL: 'silent',
      APP_TZ: 'America/New_York',
    });
    app = await buildApp({ config, pool, clock: () => NOW });
    await app.ready();
  });

  beforeEach(async () => {
    await pool.query(
      'truncate categories, transactions, recurring_rules, import_rules, alerts, digests cascade',
    );
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('applies migrations once', async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  it('requires the API token everywhere except the health check', async () => {
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/summary' })).statusCode).toBe(401);
    const wrong = await app.inject({
      url: '/api/summary',
      headers: { authorization: 'Bearer nope' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('rejects invalid input with field-level detail', async () => {
    const { status, body } = await call('POST', '/api/transactions', {
      occurredOn: '2026-02-30',
      description: '',
      amountCents: 12.5,
    });
    expect(status).toBe(400);
    expect(body.error.issues.map((issue: { path: string }) => issue.path).sort()).toEqual([
      'amountCents',
      'description',
      'occurredOn',
    ]);
  });

  it('maps constraint violations to clear client errors', async () => {
    await category('Groceries');
    expect((await call('POST', '/api/categories', { name: 'groceries' })).status).toBe(409);
    const orphan = await spend('7b0e9f0a-0000-4000-8000-000000000000', 100);
    expect(orphan.status).toBe(422);
    expect(
      (await call('DELETE', '/api/transactions/7b0e9f0a-0000-4000-8000-000000000000')).status,
    ).toBe(404);
  });

  it('summarizes the month and reserves upcoming bills in safe-to-spend', async () => {
    const groceries = await category('Groceries', 60_000);
    const rent = await category('Rent', 150_000);
    await spend(groceries, 20_000);
    await spend(null, 5_000);
    await spend(groceries, 9_900, '2026-10-31'); // Previous month: excluded.
    await call('POST', '/api/transactions', {
      occurredOn: '2026-11-01',
      description: 'Paycheck',
      amountCents: 400_000,
      kind: 'income',
    });
    await call('POST', '/api/recurring', {
      description: 'Rent',
      amountCents: 150_000,
      categoryId: rent,
      cadence: 'monthly',
      startsOn: '2026-11-28',
    });

    const { body } = await call('GET', '/api/summary');
    expect(body.month).toBe('2026-11');
    expect(body.totals).toEqual({
      incomeCents: 400_000,
      expenseCents: 25_000,
      budgetCents: 210_000,
      remainingCents: 185_000,
      uncategorizedCents: 5_000,
    });
    // (210,000 - 25,000 - 150,000 rent still to post) / 14 days left = 2,500 per day.
    expect(body.safeToSpend).toEqual({
      perDayCents: 2_500,
      availableCents: 35_000,
      upcomingCents: 150_000,
      daysLeft: 14,
    });
    expect(body.daily).toHaveLength(30);
    expect(body.daily[9]).toEqual({ date: '2026-11-10', cents: 25_000 });
    expect(body.upcoming).toEqual([
      { date: '2026-11-28', description: 'Rent', amountCents: 150_000 },
    ]);
  });

  it('raises each budget alert exactly once', async () => {
    const dining = await category('Dining', 10_000);
    await spend(dining, 7_000);
    expect((await call('GET', '/api/alerts')).body).toHaveLength(0);
    await spend(dining, 1_500);
    await spend(dining, 100);
    await spend(dining, 5_000);
    const alerts = (await call('GET', '/api/alerts')).body;
    expect(alerts.map((alert: { threshold: number }) => alert.threshold).sort()).toEqual([100, 80]);
    expect(alerts.every((alert: { categoryName: string }) => alert.categoryName === 'Dining')).toBe(
      true,
    );
  });

  it('posts recurring items with catch-up and never double-posts', async () => {
    const subs = await category('Subscriptions', 5_000);
    await call('POST', '/api/recurring', {
      description: 'Gym',
      amountCents: 2_500,
      categoryId: subs,
      cadence: 'weekly',
      startsOn: '2026-11-01',
    });

    const first = await call('POST', '/api/automation/run');
    expect(first.body).toMatchObject({ posted: 3, digestCreated: true });
    const second = await call('POST', '/api/automation/run');
    expect(second.body).toMatchObject({ posted: 0, digestCreated: false });

    const posted = (await call('GET', '/api/transactions?month=2026-11')).body;
    expect(posted.map((t: { occurredOn: string }) => t.occurredOn)).toEqual([
      '2026-11-15',
      '2026-11-08',
      '2026-11-01',
    ]);
    expect(posted.every((t: { source: string }) => t.source === 'recurring')).toBe(true);
    const [rule] = (await call('GET', '/api/recurring')).body;
    expect(rule).toMatchObject({ nextRun: '2026-11-22', lastPostedOn: '2026-11-15' });
    // 7,500 against a 5,000 budget: automation raises alerts too.
    expect((await call('GET', '/api/alerts')).body).toHaveLength(2);
  });

  it('writes one digest per day covering yesterday', async () => {
    const groceries = await category('Groceries', 10_000);
    await spend(groceries, 8_500, '2026-11-16');
    await call('POST', '/api/automation/run');
    await call('POST', '/api/automation/run');
    const digests = (await call('GET', '/api/digests')).body;
    expect(digests).toHaveLength(1);
    expect(digests[0].date).toBe('2026-11-16');
    expect(digests[0].payload.yesterday).toEqual({
      spentCents: 8_500,
      transactions: 1,
      topCategories: [{ name: 'Groceries', cents: 8_500 }],
    });
    expect(digests[0].payload.watch).toEqual([{ name: 'Groceries', percent: 85 }]);
  });

  it('imports a bank CSV, categorizes by rule and skips duplicates on re-import', async () => {
    const groceries = await category('Groceries', 10_000);
    await call('POST', '/api/import-rules', { pattern: 'trader joe', categoryId: groceries });
    const csv = [
      'Date,Description,Amount',
      "11/03/2026,TRADER JOE'S #552,-84.12",
      '11/04/2026,PAYROLL ACME,2500.00',
      '11/05/2026,UNKNOWN SHOP,-10.00',
      'bad,row,here',
    ].join('\n');
    const upload = () =>
      app.inject({
        method: 'POST',
        url: '/api/imports',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'text/csv' },
        payload: csv,
      });

    expect((await upload()).json()).toEqual({
      imported: 3,
      duplicates: 0,
      uncategorized: 1,
      errors: [{ row: 5, reason: 'Unrecognized date "bad"' }],
    });
    expect((await upload()).json()).toMatchObject({ imported: 0, duplicates: 3 });

    const { body } = await call('GET', '/api/summary');
    expect(body.categories.find((c: { name: string }) => c.name === 'Groceries').totalCents).toBe(
      8_412,
    );
    expect(body.totals.incomeCents).toBe(250_000);
    // 84.12 of 100.00 crosses 80%.
    expect((await call('GET', '/api/alerts')).body).toHaveLength(1);
  });

  it('pushes committed changes to live subscribers after in-band auth', async () => {
    const rejected = await app.injectWS('/api/live');
    const closed = new Promise<number>((resolve) => rejected.once('close', resolve));
    rejected.send(JSON.stringify({ type: 'auth', token: 'wrong' }));
    expect(await closed).toBe(4401);

    const socket = await app.injectWS('/api/live');
    const messages: { type: string; data?: Record<string, unknown> }[] = [];
    socket.on('message', (raw) => messages.push(JSON.parse(String(raw))));
    const until = async (type: string) => {
      for (let i = 0; i < 100 && !messages.some((m) => m.type === type); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return messages.find((m) => m.type === type);
    };

    socket.send(JSON.stringify({ type: 'auth', token: TOKEN }));
    expect(await until('ready')).toBeDefined();

    const dining = await category('Dining', 1_000);
    const created = await spend(dining, 1_000);
    expect((await until('transaction.changed'))?.data).toEqual({
      action: 'created',
      id: created.body.id,
    });
    expect((await until('budget.alert'))?.data).toMatchObject({ categoryName: 'Dining' });
    socket.terminate();
  });
});
