import { useState, type FormEvent } from 'react';
import {
  api,
  type Cadence,
  type Category,
  type Kind,
  type RecurringRule,
  type Summary,
} from '../api.ts';
import { money, parseMoney, shortDate } from '../format.ts';
import { Empty, Panel, type Run } from './ui.tsx';

interface Props {
  summary: Summary;
  rules: RecurringRule[];
  categories: Category[];
  run: Run;
  onRunAutomation: () => void;
}

export function Recurring({ summary, rules, categories, run, onRunAutomation }: Props) {
  const { currency } = summary;
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<Kind>('expense');
  const [cadence, setCadence] = useState<Cadence>('monthly');
  const [startsOn, setStartsOn] = useState(summary.today);
  const [categoryId, setCategoryId] = useState('');

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const amountCents = parseMoney(amount);
    if (!amountCents || !description.trim()) return;
    const body = {
      description: description.trim(),
      amountCents,
      kind,
      cadence,
      startsOn,
      categoryId: categoryId || null,
    };
    if (await run(() => api.createRecurring(body))) {
      setDescription('');
      setAmount('');
    }
  };

  return (
    <Panel
      title="Bills and income on autopilot"
      action={
        <button type="button" className="btn btn-small" onClick={onRunAutomation}>
          Run now
        </button>
      }
    >
      {rules.length === 0 && (
        <Empty>Add rent, subscriptions or a paycheck. They post themselves on the due date.</Empty>
      )}
      <ul className="rows">
        {rules.map((rule) => (
          <li key={rule.id} className={`rule${rule.active ? '' : ' is-paused'}`}>
            <div>
              <div>{rule.description}</div>
              <div className="muted small">
                {rule.cadence} · {rule.active ? `next ${shortDate(rule.nextRun)}` : 'paused'}
              </div>
            </div>
            <span className="spacer" />
            <span className="num">
              {rule.kind === 'income' ? '+' : ''}
              {money(rule.amountCents, currency)}
            </span>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => void run(() => api.updateRecurring(rule.id, { active: !rule.active }))}
            >
              {rule.active ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Delete ${rule.description}`}
              onClick={() => void run(() => api.deleteRecurring(rule.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <form className="form-grid" onSubmit={add}>
        <input
          aria-label="Description"
          placeholder="Description"
          maxLength={140}
          required
          className="span-2"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <input
          aria-label="Amount"
          placeholder="0.00"
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <select
          aria-label="Type"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as Kind);
            setCategoryId('');
          }}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <select
          aria-label="Repeats"
          value={cadence}
          onChange={(event) => setCadence(event.target.value as Cadence)}
        >
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        <input
          type="date"
          aria-label="First due date"
          required
          value={startsOn}
          onChange={(event) => setStartsOn(event.target.value)}
        />
        <select
          aria-label="Category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">Uncategorized</option>
          {categories
            .filter((category) => category.kind === kind)
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </select>
        <button type="submit" className="btn">
          Add schedule
        </button>
      </form>
    </Panel>
  );
}
