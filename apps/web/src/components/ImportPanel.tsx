import { useState, type DragEvent, type FormEvent } from 'react';
import { api, type Category, type ImportResult, type ImportRule } from '../api.ts';
import { Panel, type Run } from './ui.tsx';

interface Props {
  rules: ImportRule[];
  categories: Category[];
  run: Run;
}

export function ImportPanel({ rules, categories, run }: Props) {
  const expense = categories.filter((category) => category.kind === 'expense');
  const [positiveIsExpense, setPositiveIsExpense] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const names = new Map(categories.map((category) => [category.id, category.name]));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    await run(async () => setResult(await api.importCsv(text, positiveIsExpense)));
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files[0]);
  };

  const addRule = async (event: FormEvent) => {
    event.preventDefault();
    if (!pattern.trim() || !categoryId) return;
    if (await run(() => api.createImportRule({ pattern: pattern.trim(), categoryId })))
      setPattern('');
  };

  return (
    <Panel title="Bank import">
      <label
        className={`drop${dragging ? ' is-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <strong>Drop a bank CSV here</strong>
        <span className="muted small">
          or click to choose. Re-importing never creates duplicates.
        </span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={positiveIsExpense}
          onChange={(event) => setPositiveIsExpense(event.target.checked)}
        />
        Charges are positive numbers (credit card export)
      </label>

      {result && (
        <div className="result" role="status">
          Imported {result.imported}, skipped {result.duplicates} duplicate
          {result.duplicates === 1 ? '' : 's'}
          {result.uncategorized > 0 && `, ${result.uncategorized} need a category`}.
          {result.errors.length > 0 && (
            <ul>
              {result.errors.slice(0, 5).map((error) => (
                <li key={error.row}>
                  Row {error.row}: {error.reason}
                </li>
              ))}
              {result.errors.length > 5 && <li>and {result.errors.length - 5} more</li>}
            </ul>
          )}
        </div>
      )}

      <h3 className="subhead">Auto-categorize rules</h3>
      <ul className="rows">
        {rules.map((rule) => (
          <li key={rule.id} className="rule">
            <span>
              contains <code>{rule.pattern}</code>
            </span>
            <span className="spacer" />
            <span className="muted">{names.get(rule.categoryId)}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Delete rule ${rule.pattern}`}
              onClick={() => void run(() => api.deleteImportRule(rule.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form className="form-row" onSubmit={addRule}>
        <input
          aria-label="Description contains"
          placeholder="Description contains…"
          maxLength={80}
          className="grow"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
        />
        <select
          aria-label="Assign category"
          required
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">Category</option>
          {expense.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn">
          Add rule
        </button>
      </form>
    </Panel>
  );
}
