import type { ReactNode } from 'react';

/** Runs a mutation, then refreshes the dashboard. Failure becomes a toast. Resolves true on success. */
export type Run = (work: () => Promise<unknown>) => Promise<boolean>;

export function Panel(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{props.title}</h2>
        {props.action}
      </header>
      {props.children}
    </section>
  );
}

const ICONS = { good: '✓', warning: '▲', critical: '●' } as const;
export type Tone = keyof typeof ICONS;

/** Status is never carried by color alone: every chip pairs an icon with a label. */
export function Status(props: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`status status-${props.tone}`}>
      <span aria-hidden="true">{ICONS[props.tone]}</span>
      {props.children}
    </span>
  );
}

export function Meter(props: { value: number; max: number; label: string }) {
  const ratio = props.max > 0 ? props.value / props.max : 0;
  const tone = ratio >= 1 ? 'critical' : ratio >= 0.8 ? 'warning' : 'normal';
  return (
    <div
      className="meter"
      role="meter"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(ratio * 100))}
    >
      <div
        className={`meter-fill meter-${tone}`}
        style={{ width: `${Math.min(100, ratio * 100)}%` }}
      />
    </div>
  );
}

export function Empty(props: { children: ReactNode }) {
  return <p className="empty">{props.children}</p>;
}
