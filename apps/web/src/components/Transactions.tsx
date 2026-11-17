import { useState, type FormEvent } from 'react';
import { api, type Category, type Kind, type Summary, type Transaction } from '../api.ts';
import { money, parseMoney, shortDate } from '../format.ts';
import { Empty, Panel, type Run } from './ui.tsx';

interface Props {
  summary: Summary;
  transactions: Transaction[];
  categories: Category[];
  run: Run;
}

export function Transactions({ summary, transactions, categories, run }: Props) {
  const { currency } = summary;
  const [date, setDate] = useState(summary.today);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<Kind>('expense');
  const [categoryId, setCategoryId] = useState('');
  const amountCents = parseMoney(amount);
  const choices = categories.filter((category) => category.kind === kind);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (amountCents === null || amountCents === 0 || !description.trim()) return;
    const body = {
      occurredOn: date,
      description: description.trim(),
      amountCents,
      kind,
      categoryId: categoryId || null,
    };
    if (await run(() => api.createTransaction(body))) {
      setDescription('');
      setAmount('');
    }
  };

  return (
    <Panel
      title="Transactions"
      action={<span className="muted">{transactions.length} this month</span>}
    >
      <form className="form-row" onSubmit={add}>
        <input
          type="date"
          aria-label="Date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <input
          aria-label="Description"
          placeholder="Description"
          maxLength={140}
          required
          className="grow"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <input
          aria-label="Amount"
          placeholder="0.00"
          inputMode="decimal"
          required
          className="narrow"
          aria-invalid={amount !== '' && amountCents === null}
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
          aria-label="Category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
        >
          <option value="">Uncategorized</option>
          {choices.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary">
          Add
        </button>
      </form>

      {transactions.length === 0 ? (
        <Empty>Nothing here yet this month.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th className="right">Amount</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="nowrap muted">{shortDate(transaction.occurredOn)}</td>
                  <td>
                    {transaction.description}
                    {transaction.source !== 'manual' && (
                      <span className="tag">{transaction.source}</span>
                    )}
                  </td>
                  <td>
                    <select
                      className="quiet"
                      aria-label={`Category for ${transaction.description}`}
                      value={transaction.categoryId ?? ''}
                      onChange={(event) =>
                        void run(() =>
                          api.updateTransaction(transaction.id, {
                            categoryId: event.target.value || null,
                          }),
                        )
                      }
                    >
                      <option value="">Uncategorized</option>
                      {categories
                        .filter((category) => category.kind === transaction.kind)
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="right num nowrap">
                    {transaction.kind === 'income' ? '+' : ''}
                    {money(transaction.amountCents, currency)}
                  </td>
                  <td className="right">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete ${transaction.description}`}
                      onClick={() => void run(() => api.deleteTransaction(transaction.id))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
