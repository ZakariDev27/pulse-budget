import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ApiError,
  tokenStore,
  type Alert,
  type Category,
  type Digest,
  type ImportRule,
  type LiveEvent,
  type RecurringRule,
  type Summary,
  type Transaction,
} from './api.ts';
import { Activity } from './components/Activity.tsx';
import { Budgets } from './components/Budgets.tsx';
import { ImportPanel } from './components/ImportPanel.tsx';
import { Recurring } from './components/Recurring.tsx';
import { SpendChart } from './components/SpendChart.tsx';
import { Tiles } from './components/Tiles.tsx';
import { Transactions } from './components/Transactions.tsx';
import type { Run, Tone } from './components/ui.tsx';
import { monthLabel, shiftMonth } from './format.ts';
import { useLive } from './live.ts';

interface Dashboard {
  summary: Summary;
  transactions: Transaction[];
  categories: Category[];
  recurring: RecurringRule[];
  alerts: Alert[];
  digests: Digest[];
  importRules: ImportRule[];
}

interface Toast {
  id: number;
  tone: Tone | 'info';
  text: string;
}

async function fetchDashboard(month: string | null): Promise<Dashboard> {
  const summary = await api.summary(month);
  const [transactions, categories, recurring, alerts, digests, importRules] = await Promise.all([
    api.transactions(summary.month),
    api.categories(),
    api.recurring(),
    api.alerts(),
    api.digests(),
    api.importRules(),
  ]);
  return { summary, transactions, categories, recurring, alerts, digests, importRules };
}

const STATUS_LABEL = { live: 'Live', connecting: 'Connecting', offline: 'Reconnecting' } as const;

function describe(event: LiveEvent): Omit<Toast, 'id'> | null {
  switch (event.type) {
    case 'budget.alert':
      return event.data.threshold >= 100
        ? { tone: 'critical', text: `${event.data.categoryName} went over budget` }
        : {
            tone: 'warning',
            text: `${event.data.categoryName} reached ${event.data.threshold}% of its budget`,
          };
    case 'recurring.posted':
      return {
        tone: 'info',
        text: `Posted ${event.data.count} scheduled item${event.data.count === 1 ? '' : 's'}`,
      };
    case 'import.completed':
      return {
        tone: 'info',
        text: `Imported ${event.data.imported} transaction${event.data.imported === 1 ? '' : 's'}`,
      };
    case 'digest.created':
      return { tone: 'info', text: 'Your daily digest is ready' };
    default:
      return null;
  }
}

export function App() {
  /** null follows the server's current month, so the view rolls over at midnight in the app's zone. */
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [version, refresh] = useReducer((count: number) => count + 1, 0);
  const nextToastId = useRef(1);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((tone: Toast['tone'], text: string) => {
    const id = nextToastId.current++;
    setToasts((current) => [...current.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 6_000);
  }, []);

  useEffect(() => {
    // A slower, older request must not overwrite a newer one.
    let stale = false;
    fetchDashboard(month).then(
      (next) => {
        if (stale) return;
        setData(next);
        setLocked(false);
        setLoadError(null);
      },
      (error: unknown) => {
        if (stale) return;
        if (error instanceof ApiError && error.status === 401) {
          setLocked(true);
          setLoadError(tokenStore.get() ? 'That token was not accepted.' : null);
        } else {
          setLoadError(error instanceof Error ? error.message : 'Could not reach the server');
        }
      },
    );
    return () => {
      stale = true;
    };
  }, [month, version]);

  /** Bursts of events (an import, a catch-up run) collapse into one refetch. */
  const refreshSoon = useCallback(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(refresh, 150);
  }, []);

  const status = useLive(
    !locked,
    (event) => {
      const message = describe(event);
      if (message) toast(message.tone, message.text);
      refreshSoon();
    },
    refreshSoon,
  );

  const run: Run = useCallback(
    async (work) => {
      try {
        await work();
        refresh();
        return true;
      } catch (error) {
        toast('critical', error instanceof Error ? error.message : 'Something went wrong');
        return false;
      }
    },
    [toast],
  );

  const runAutomation = () =>
    void run(async () => {
      const result = await api.runAutomation();
      if (result.skipped) toast('info', 'Automation is already running');
      else if (!result.posted && !result.digestCreated)
        toast('info', 'Everything is already up to date');
    });

  const shown = data?.summary.month ?? null;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <path
              d="M5 17h5l3-8 5 14 3-6h6"
              fill="none"
              stroke="#fff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h1>Pulse</h1>
        </div>
        {shown && (
          <nav className="month" aria-label="Month">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous month"
              onClick={() => setMonth(shiftMonth(shown, -1))}
            >
              ‹
            </button>
            <span>{monthLabel(shown)}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next month"
              onClick={() => setMonth(shiftMonth(shown, 1))}
            >
              ›
            </button>
            {month !== null && (
              <button type="button" className="btn btn-small" onClick={() => setMonth(null)}>
                Today
              </button>
            )}
          </nav>
        )}
        <span className={`live live-${status}`} role="status">
          <span className="live-dot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
      </header>

      {loadError && (
        <div className="banner" role="alert">
          {loadError}
          <button type="button" className="btn btn-small" onClick={refresh}>
            Retry
          </button>
        </div>
      )}

      {locked ? (
        <TokenGate onSubmit={refresh} />
      ) : !data ? (
        !loadError && <p className="empty">Loading…</p>
      ) : (
        <main>
          <Tiles summary={data.summary} />
          <div className="columns">
            <div className="stack">
              <Budgets summary={data.summary} run={run} />
              <SpendChart summary={data.summary} />
              <Transactions
                summary={data.summary}
                transactions={data.transactions}
                categories={data.categories}
                run={run}
              />
            </div>
            <div className="stack">
              <Recurring
                summary={data.summary}
                rules={data.recurring}
                categories={data.categories}
                run={run}
                onRunAutomation={runAutomation}
              />
              <ImportPanel rules={data.importRules} categories={data.categories} run={run} />
              <Activity
                alerts={data.alerts}
                digests={data.digests}
                currency={data.summary.currency}
              />
            </div>
          </div>
        </main>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`}>
            {item.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenGate({ onSubmit }: { onSubmit: () => void }) {
  const [token, setToken] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    tokenStore.set(token.trim());
    onSubmit();
  };
  return (
    <form className="panel gate" onSubmit={submit}>
      <h2>Enter your API token</h2>
      <p className="muted">
        This server is protected. Use the API_TOKEN value from its configuration.
      </p>
      <input
        type="password"
        aria-label="API token"
        autoComplete="current-password"
        autoFocus
        required
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />
      <button type="submit" className="btn btn-primary">
        Unlock
      </button>
    </form>
  );
}
