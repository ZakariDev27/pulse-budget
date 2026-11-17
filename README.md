# Pulse Budget

[![CI](https://github.com/ZakariDev27/pulse-budget/actions/workflows/ci.yml/badge.svg)](https://github.com/ZakariDev27/pulse-budget/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A budget app you host yourself that does the boring parts for you. Rent and paychecks post themselves on the day they're due, bank exports drop in without duplicates, and every open dashboard updates the second something changes. Front and center is the one number you actually care about: **how much you can safely spend today.**

![Pulse dashboard](docs/dashboard.png)

## What it does

- **Safe to spend today.** Your budget, minus what you've spent, minus the bills still coming this month, spread across the days you have left.
- **Daily automation.** Every morning a worker posts your recurring bills and income and writes up yesterday's spending. If it was down for a few days, it catches up on every date it missed as soon as it's back.
- **Live updates.** Add a transaction on your phone and watch it land on your laptop. Anything the API, the worker or an import changes shows up in every open browser, no refresh needed.
- **Budget alerts.** You get a heads-up when a category hits 80% of its budget and again when it goes over. Once each, so it never nags.
- **Bank CSV import.** Drop in an export from your bank or card and it sorts transactions into categories using rules you set. Import the same file twice and nothing gets doubled.
- **Daily digest.** A short morning recap in the app, and in Slack or Discord too if you add a webhook.

## Quick start

All you need is Docker with Compose v2.

```bash
git clone https://github.com/ZakariDev27/pulse-budget.git
cd pulse-budget
cp .env.example .env        # set POSTGRES_PASSWORD
docker compose up --build -d
```

Then open <http://localhost:8080>. Want to see it with a month of sample data first? This needs Node 22:

```bash
npm run seed
```

## Architecture

```mermaid
flowchart LR
  browser([Browser])
  subgraph compose [Docker Compose]
    web[web<br/>nginx + React build]
    api[api<br/>Fastify REST + WebSocket]
    worker[worker<br/>daily automation]
    db[(db<br/>PostgreSQL 17)]
  end
  hook([Slack / Discord])

  browser -- "HTTP + WebSocket :8080" --> web
  web -- "/api" --> api
  api -- SQL --> db
  worker -- SQL --> db
  db -. "LISTEN / NOTIFY" .-> api
  worker -. "daily digest" .-> hook
```

| Container | Role                                                                                          |
| --------- | --------------------------------------------------------------------------------------------- |
| `web`     | Unprivileged nginx. Serves the dashboard and proxies `/api`. The only published port.         |
| `api`     | REST API and live feed. Applies database migrations on start.                                 |
| `worker`  | Same image as `api`, different command. Runs the daily job at startup and on a cron schedule. |
| `db`      | PostgreSQL with a named volume.                                                               |

### Why it's built this way

**Postgres doubles as the event bus.** Changes are announced with `NOTIFY` from inside the same transaction that made them, so an event only goes out if the change actually commits. The API keeps one `LISTEN` connection open and fans events out to WebSocket clients. That lets the worker reach every browser without a message broker, which is one less container to babysit.

**The daily job is safe to run twice.** Due rows are claimed with `FOR UPDATE SKIP LOCKED`, a unique index on (rule, date) turns a repeat post into a no-op, there's one digest per day, and an advisory lock skips overlapping runs. So it can run at startup, on schedule and whenever you click "Run now", and if it crashes halfway you just run it again.

**Money is whole cents and dates are just dates.** No floating point ever touches an amount, even when parsing CSVs. "Today" comes from `APP_TZ` rather than the server's clock, so a bill due on the 1st posts on the 1st where you live.

**Month-end bills don't drift.** A bill set up on the 31st posts on Feb 28, then goes right back to the 31st in March.

**Imports are fingerprinted.** Every row gets a content hash that also counts how many times it appears in the file. Overlapping exports get deduplicated, but two identical coffees on the same day both still count.

## Configuration

Everything lives in `.env`. Start from [`.env.example`](.env.example).

| Variable             | Default            | Purpose                                                                  |
| -------------------- | ------------------ | ------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD`  | required           | Database password.                                                       |
| `APP_TZ`             | `America/New_York` | IANA time zone that defines "today".                                     |
| `CURRENCY`           | `USD`              | ISO 4217 code used for display.                                          |
| `API_TOKEN`          | unset              | When set (16+ characters), required by the API, dashboard and live feed. |
| `DAILY_CRON`         | `0 6 * * *`        | Schedule for the daily job, evaluated in `APP_TZ`.                       |
| `DIGEST_WEBHOOK_URL` | unset              | Slack or Discord incoming webhook for the digest.                        |
| `WEB_PORT`           | `8080`             | Host port for the dashboard.                                             |

Before you put this anywhere other people can reach it, set `API_TOKEN` and serve it over HTTPS. Pulse is built for one household, so it uses a single token and has no user accounts.

## API

Plain JSON over HTTP, all under `/api`. Amounts are in cents and dates look like `YYYY-MM-DD`. If you've set `API_TOKEN`, send it as `Authorization: Bearer <token>`.

| Method and path                        | Description                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/health`                      | Liveness and database reachability. Never requires a token.                         |
| `GET /api/summary?month=YYYY-MM`       | Totals, safe-to-spend, per-category progress, daily series, upcoming bills.         |
| `GET` `POST /api/transactions`         | List (`month`, `categoryId`, `limit`) or create.                                    |
| `PATCH` `DELETE /api/transactions/:id` | Update or delete.                                                                   |
| `GET` `POST /api/categories`           | List or create categories with a monthly budget.                                    |
| `PATCH` `DELETE /api/categories/:id`   | Rename, change budget, or delete.                                                   |
| `GET` `POST /api/recurring`            | List or create schedules (`weekly`, `biweekly`, `monthly`, `yearly`).               |
| `PATCH` `DELETE /api/recurring/:id`    | Pause, resume, edit or delete.                                                      |
| `POST /api/imports`                    | Import a CSV sent as a `text/csv` body. `?positiveIsExpense=true` for card exports. |
| `GET` `POST /api/import-rules`         | List or create "description contains" rules.                                        |
| `DELETE /api/import-rules/:id`         | Delete a rule.                                                                      |
| `GET /api/alerts` · `GET /api/digests` | Recent budget alerts and daily digests.                                             |
| `POST /api/automation/run`             | Run the daily job now.                                                              |
| `GET /api/live`                        | WebSocket feed of change events.                                                    |

```bash
curl -X POST http://localhost:8080/api/transactions \
  -H 'content-type: application/json' \
  -d '{"occurredOn":"2026-11-17","description":"Coffee","amountCents":450}'

curl -X POST http://localhost:8080/api/imports \
  -H 'content-type: text/csv' --data-binary @statement.csv
```

Errors always come back in the same shape: `{"error":{"code":"invalid_request","message":"...","issues":[...]}}`.

The live feed says `{"type":"ready"}` once you're subscribed, then sends events like `transaction.changed`, `budget.alert`, `recurring.posted`, `import.completed` and `digest.created`. If a token is set, the first thing the client sends has to be `{"type":"auth","token":"..."}`. Doing it that way keeps the token out of URLs and logs.

## Development

```bash
npm ci
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
npm run dev          # API on :3000, worker, dashboard on :5173
```

| Command         | What it runs                                                          |
| --------------- | --------------------------------------------------------------------- |
| `npm run check` | Lint, format check, typecheck and tests.                              |
| `npm test`      | Vitest. Unit tests always; API tests when `TEST_DATABASE_URL` is set. |
| `npm run build` | Compile the API and bundle the dashboard.                             |
| `npm run seed`  | Load demo data through the API (`API_URL`, `API_TOKEN`).              |

The API tests run against a real PostgreSQL and wipe its schema each time, so point `TEST_DATABASE_URL` at a database you don't mind losing:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec db createdb -U pulse pulse_test
TEST_DATABASE_URL=postgres://pulse:change-me@localhost:5432/pulse_test npm test
```

### Layout

```
apps/api      Fastify API and worker (TypeScript, PostgreSQL)
  migrations  Plain SQL, applied in order on start
  src/domain  Pure logic: dates, recurrence, budgets, CSV parsing
  src/services  Database-backed use cases
  src/routes  HTTP and WebSocket handlers
apps/web      React dashboard (Vite)
scripts       Demo data seeder
```

### Continuous integration

Every push and pull request gets linted, typechecked, tested against PostgreSQL and built. Then CI builds all the containers, boots the whole stack and pokes at it through the web container to make sure it really works. Pushes to `main` and version tags publish images to GitHub Container Registry.

## License

[MIT](LICENSE) © ZaKari Perry
