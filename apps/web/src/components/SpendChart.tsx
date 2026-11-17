import { useState } from 'react';
import type { Summary } from '../api.ts';
import { money, moneyRounded, shortDate } from '../format.ts';
import { Panel } from './ui.tsx';

/** Rounds up to a clean axis maximum (1, 2 or 5 times a power of ten). */
function niceMax(cents: number): number {
  if (cents <= 0) return 10_000;
  const magnitude = 10 ** Math.floor(Math.log10(cents));
  const step = [1, 2, 5, 10].find((multiple) => multiple * magnitude >= cents) ?? 10;
  return step * magnitude;
}

export function SpendChart({ summary }: { summary: Summary }) {
  const { daily, currency, today } = summary;
  const [hovered, setHovered] = useState<number | null>(null);
  const max = niceMax(Math.max(...daily.map((day) => day.cents)));
  const active = hovered === null ? null : daily[hovered];

  return (
    <Panel
      title="Day-to-day spending"
      action={
        <span className="muted num" aria-live="polite">
          {active
            ? `${shortDate(active.date)}: ${money(active.cents, currency)}`
            : 'Hover a day for detail'}
        </span>
      }
    >
      <div className="chart">
        <div className="chart-axis" aria-hidden="true">
          <span>{moneyRounded(max, currency)}</span>
          <span>{moneyRounded(max / 2, currency)}</span>
          <span>{moneyRounded(0, currency)}</span>
        </div>
        <ol
          className="chart-plot"
          aria-label="Spending by day"
          onMouseLeave={() => setHovered(null)}
        >
          {daily.map((day, index) => (
            <li
              key={day.date}
              className={`chart-col${hovered === index ? ' is-active' : ''}${day.date === today ? ' is-today' : ''}`}
              tabIndex={0}
              aria-label={`${shortDate(day.date)}: ${money(day.cents, currency)}`}
              onMouseEnter={() => setHovered(index)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
            >
              <span className="chart-bar" style={{ height: `${(day.cents / max) * 100}%` }} />
            </li>
          ))}
        </ol>
      </div>
      <div className="chart-x" aria-hidden="true">
        <span>{daily[0] && shortDate(daily[0].date)}</span>
        <span>
          {today.startsWith(summary.month) ? 'Today is outlined · ' : ''}Scheduled bills not
          included
        </span>
        <span>{daily.at(-1) && shortDate(daily.at(-1)!.date)}</span>
      </div>
    </Panel>
  );
}
