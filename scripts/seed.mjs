#!/usr/bin/env node
// Loads demo data through the public API, so it exercises the same paths the app does.
// Usage: npm run seed   (API_URL and API_TOKEN are read from the environment)

const API_URL = process.env.API_URL ?? 'http://localhost:8080';
const TOKEN = process.env.API_TOKEN;

async function call(method, path, body, contentType = 'application/json') {
  const response = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      ...(body === undefined ? {} : { 'content-type': contentType }),
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${method} ${path} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

const { today } = await call('GET', '/summary');
const month = today.slice(0, 7);
const dayOfMonth = Number(today.slice(8, 10));
const day = (n) => `${month}-${String(Math.min(Math.max(n, 1), dayOfMonth)).padStart(2, '0')}`;

const category = {};
for (const [name, budget, kind] of [
  ['Housing', 1600, 'expense'],
  ['Groceries', 520, 'expense'],
  ['Dining', 220, 'expense'],
  ['Transport', 180, 'expense'],
  ['Subscriptions', 60, 'expense'],
  ['Salary', 0, 'income'],
]) {
  const created = await call('POST', '/categories', {
    name,
    kind,
    monthlyBudgetCents: budget * 100,
  });
  category[name] = created.id;
}

for (const [pattern, name] of [
  ['whole foods', 'Groceries'],
  ['trader joe', 'Groceries'],
  ['uber', 'Transport'],
  ['shell', 'Transport'],
  ['chipotle', 'Dining'],
  ['sweetgreen', 'Dining'],
  ['blue bottle', 'Dining'],
]) {
  await call('POST', '/import-rules', { pattern, categoryId: category[name] });
}

for (const [description, amount, kind, name, cadence, startsOn] of [
  ['Rent', 1450, 'expense', 'Housing', 'monthly', `${month}-01`],
  ['Paycheck', 2400, 'income', 'Salary', 'biweekly', `${month}-01`],
  ['Streaming bundle', 22.99, 'expense', 'Subscriptions', 'monthly', `${month}-05`],
  ['Gym', 35, 'expense', 'Subscriptions', 'monthly', `${month}-28`],
]) {
  await call('POST', '/recurring', {
    description,
    amountCents: Math.round(amount * 100),
    kind,
    categoryId: category[name],
    cadence,
    startsOn,
  });
}

const rows = [
  [2, 'WHOLE FOODS MARKET #1042', -96.4],
  [3, 'UBER *TRIP', -18.25],
  [4, 'CHIPOTLE 2217', -14.85],
  [6, "TRADER JOE'S #552", -71.32],
  [7, 'SHELL OIL 5742', -48.1],
  [9, 'SWEETGREEN MIDTOWN', -16.75],
  [10, 'BLUE BOTTLE COFFEE', -6.5],
  [11, 'WHOLE FOODS MARKET #1042', -112.08],
  [12, 'HARDWARE STORE', -39.99],
  [13, 'CHIPOTLE 2217', -27.4],
  [14, 'UBER *TRIP', -23.6],
  [15, "TRADER JOE'S #552", -88.9],
  [dayOfMonth - 1, 'SWEETGREEN MIDTOWN', -34.2],
  [dayOfMonth - 1, 'WHOLE FOODS MARKET #1042', -64.15],
  [dayOfMonth, 'BLUE BOTTLE COFFEE', -6.5],
];
const csv = [
  'Date,Description,Amount',
  ...rows.map(([n, text, amount]) => `${day(n)},${text},${amount}`),
].join('\n');
const imported = await call('POST', '/imports', csv, 'text/csv');
const automation = await call('POST', '/automation/run');

console.log(
  `Seeded ${month}: imported ${imported.imported} transactions, posted ${automation.posted} scheduled items.`,
);
