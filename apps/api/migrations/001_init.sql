-- Money is stored as integer cents. Dates are calendar dates in the app's time zone.

create table categories (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(btrim(name)) between 1 and 60),
  kind                 text not null default 'expense' check (kind in ('expense', 'income')),
  monthly_budget_cents bigint not null default 0 check (monthly_budget_cents >= 0),
  created_at           timestamptz not null default now()
);
create unique index categories_name_key on categories (lower(name));

create table recurring_rules (
  id             uuid primary key default gen_random_uuid(),
  description    text not null check (length(btrim(description)) between 1 and 140),
  amount_cents   bigint not null check (amount_cents > 0),
  kind           text not null check (kind in ('expense', 'income')),
  category_id    uuid references categories (id) on delete set null,
  cadence        text not null check (cadence in ('weekly', 'biweekly', 'monthly', 'yearly')),
  -- Day of month the rule was created for, so a rule on the 31st returns to the 31st after February.
  anchor_day     smallint not null check (anchor_day between 1 and 31),
  next_run       date not null,
  active         boolean not null default true,
  last_posted_on date,
  created_at     timestamptz not null default now()
);
create index recurring_rules_due_idx on recurring_rules (next_run) where active;

create table transactions (
  id                uuid primary key default gen_random_uuid(),
  occurred_on       date not null,
  description       text not null check (length(btrim(description)) between 1 and 140),
  amount_cents      bigint not null check (amount_cents > 0),
  kind              text not null check (kind in ('expense', 'income')),
  category_id       uuid references categories (id) on delete set null,
  source            text not null default 'manual' check (source in ('manual', 'recurring', 'import')),
  recurring_rule_id uuid references recurring_rules (id) on delete set null,
  import_hash       text unique,
  created_at        timestamptz not null default now()
);
create index transactions_recent_idx on transactions (occurred_on desc, created_at desc);
create index transactions_category_idx on transactions (category_id, occurred_on);
-- A rule posts at most once per day: the worker can crash and retry without double-charging.
create unique index transactions_recurring_once_idx
  on transactions (recurring_rule_id, occurred_on)
  where recurring_rule_id is not null;

create table import_rules (
  id          uuid primary key default gen_random_uuid(),
  pattern     text not null check (length(btrim(pattern)) between 1 and 80),
  category_id uuid not null references categories (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create unique index import_rules_pattern_key on import_rules (lower(pattern));

create table alerts (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references categories (id) on delete cascade,
  month        date not null,
  threshold    smallint not null check (threshold in (80, 100)),
  spent_cents  bigint not null,
  budget_cents bigint not null,
  created_at   timestamptz not null default now(),
  -- Each threshold fires once per category per month.
  unique (category_id, month, threshold)
);
create index alerts_recent_idx on alerts (created_at desc);

create table digests (
  id          uuid primary key default gen_random_uuid(),
  digest_date date not null unique,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);
