import type { Summary } from '../api.ts';
import { money, moneyRounded, percent } from '../format.ts';
import { Meter, Status } from './ui.tsx';

export function Tiles({ summary }: { summary: Summary }) {
  const { totals, safeToSpend: safe, currency } = summary;
  const over = totals.remainingCents < 0;
  const used = percent(totals.expenseCents, totals.budgetCents);
  const net = totals.incomeCents - totals.expenseCents;

  return (
    <div className="tiles">
      <article className="tile tile-hero">
        <h2>Safe to spend today</h2>
        {safe ? (
          <>
            <p className="figure">{money(safe.perDayCents, currency)}</p>
            <p className="note">
              {money(safe.availableCents, currency)} free over {safe.daysLeft} day
              {safe.daysLeft === 1 ? '' : 's'}
              {safe.upcomingCents > 0 &&
                `, after ${money(safe.upcomingCents, currency)} in upcoming bills`}
            </p>
          </>
        ) : (
          <>
            <p className="figure figure-muted">—</p>
            <p className="note">
              {totals.budgetCents > 0
                ? 'Shown for the current month.'
                : 'Give a category a monthly budget to see this.'}
            </p>
          </>
        )}
      </article>

      <article className="tile">
        <h2>Spent</h2>
        <p className="figure">{moneyRounded(totals.expenseCents, currency)}</p>
        <Meter value={totals.expenseCents} max={totals.budgetCents} label="Share of budget spent" />
        <p className="note">
          {totals.budgetCents > 0
            ? `${used}% of ${moneyRounded(totals.budgetCents, currency)} budgeted`
            : 'No budget set'}
        </p>
      </article>

      <article className="tile">
        <h2>{over ? 'Over budget' : 'Remaining'}</h2>
        <p className="figure">{moneyRounded(Math.abs(totals.remainingCents), currency)}</p>
        <p className="note">
          {over ? (
            <Status tone="critical">Over budget</Status>
          ) : used >= 80 ? (
            <Status tone="warning">Near limit</Status>
          ) : (
            <Status tone="good">On track</Status>
          )}
        </p>
      </article>

      <article className="tile">
        <h2>Income</h2>
        <p className="figure">{moneyRounded(totals.incomeCents, currency)}</p>
        <p className="note">
          Net {net < 0 ? '−' : '+'}
          {moneyRounded(Math.abs(net), currency)} this month
        </p>
      </article>
    </div>
  );
}
