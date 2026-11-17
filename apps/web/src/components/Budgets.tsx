import { useState, type FormEvent } from 'react';
import { api, type Kind, type Summary } from '../api.ts';
import { money, parseMoney, percent } from '../format.ts';
import { Empty, Meter, Panel, Status, type Run } from './ui.tsx';

export function Budgets({ summary, run }: { summary: Summary; run: Run }) {
  const { currency } = summary;
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [kind, setKind] = useState<Kind>('expense');

  const expense = summary.categories.filter((category) => category.kind === 'expense');
  const income = summary.categories.filter((category) => category.kind === 'income');

  const saveBudget = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const cents = editing.draft.trim() === '' ? 0 : parseMoney(editing.draft);
    if (cents === null) return;
    if (await run(() => api.updateCategory(editing.id, { monthlyBudgetCents: cents })))
      setEditing(null);
  };

  const addCategory = async (event: FormEvent) => {
    event.preventDefault();
    const cents = budget.trim() === '' ? 0 : parseMoney(budget);
    if (!name.trim() || cents === null) return;
    const body = { name: name.trim(), kind, monthlyBudgetCents: kind === 'expense' ? cents : 0 };
    if (await run(() => api.createCategory(body))) {
      setName('');
      setBudget('');
    }
  };

  return (
    <Panel title="Budgets">
      {expense.length === 0 && (
        <Empty>Add a category and a monthly budget to start tracking.</Empty>
      )}
      <ul className="rows">
        {expense.map((category) => {
          const used = percent(category.totalCents, category.budgetCents);
          return (
            <li key={category.id} className="budget">
              <div className="budget-line">
                <span className="budget-name">{category.name}</span>
                {category.budgetCents > 0 && used >= 100 && <Status tone="critical">Over</Status>}
                {category.budgetCents > 0 && used >= 80 && used < 100 && (
                  <Status tone="warning">{used}%</Status>
                )}
                <span className="spacer" />
                {editing?.id === category.id ? (
                  <form className="inline" onSubmit={saveBudget}>
                    <input
                      autoFocus
                      aria-label={`Monthly budget for ${category.name}`}
                      inputMode="decimal"
                      value={editing.draft}
                      onChange={(event) =>
                        setEditing({ id: category.id, draft: event.target.value })
                      }
                      onKeyDown={(event) => event.key === 'Escape' && setEditing(null)}
                    />
                    <button type="submit" className="btn btn-small">
                      Save
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="link num"
                    title="Edit monthly budget"
                    onClick={() =>
                      setEditing({
                        id: category.id,
                        draft: category.budgetCents ? (category.budgetCents / 100).toFixed(2) : '',
                      })
                    }
                  >
                    {money(category.totalCents, currency)}
                    <span className="muted">
                      {' '}
                      /{' '}
                      {category.budgetCents > 0
                        ? money(category.budgetCents, currency)
                        : 'set budget'}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Delete ${category.name}`}
                  title="Delete category. Its transactions become uncategorized."
                  onClick={() => void run(() => api.deleteCategory(category.id))}
                >
                  ×
                </button>
              </div>
              <Meter
                value={category.totalCents}
                max={category.budgetCents}
                label={`${category.name} budget used`}
              />
            </li>
          );
        })}
        {summary.totals.uncategorizedCents > 0 && (
          <li className="budget">
            <div className="budget-line">
              <span className="budget-name muted">Uncategorized</span>
              <span className="spacer" />
              <span className="num">{money(summary.totals.uncategorizedCents, currency)}</span>
            </div>
          </li>
        )}
      </ul>

      {income.length > 0 && (
        <>
          <h3 className="subhead">Income</h3>
          <ul className="rows">
            {income.map((category) => (
              <li key={category.id} className="budget-line">
                <span className="budget-name">{category.name}</span>
                <span className="spacer" />
                <span className="num">{money(category.totalCents, currency)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Delete ${category.name}`}
                  onClick={() => void run(() => api.deleteCategory(category.id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <form className="form-row" onSubmit={addCategory}>
        <input
          aria-label="New category name"
          placeholder="New category"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          aria-label="Category type"
          value={kind}
          onChange={(event) => setKind(event.target.value as Kind)}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        {kind === 'expense' && (
          <input
            aria-label="Monthly budget"
            placeholder="Monthly budget"
            inputMode="decimal"
            className="narrow"
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
          />
        )}
        <button type="submit" className="btn">
          Add
        </button>
      </form>
    </Panel>
  );
}
