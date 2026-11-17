export type Kind = 'expense' | 'income';
export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export interface Category {
  id: string;
  name: string;
  kind: Kind;
  monthlyBudgetCents: number;
}

export interface Transaction {
  id: string;
  occurredOn: string;
  description: string;
  amountCents: number;
  kind: Kind;
  categoryId: string | null;
  source: 'manual' | 'recurring' | 'import';
}

export interface RecurringRule {
  id: string;
  description: string;
  amountCents: number;
  kind: Kind;
  categoryId: string | null;
  cadence: Cadence;
  nextRun: string;
  active: boolean;
}

export interface Summary {
  month: string;
  today: string;
  currency: string;
  timeZone: string;
  totals: {
    incomeCents: number;
    expenseCents: number;
    budgetCents: number;
    remainingCents: number;
    uncategorizedCents: number;
  };
  safeToSpend: {
    perDayCents: number;
    availableCents: number;
    upcomingCents: number;
    daysLeft: number;
  } | null;
  categories: { id: string; name: string; kind: Kind; budgetCents: number; totalCents: number }[];
  daily: { date: string; cents: number }[];
  upcoming: { date: string; description: string; amountCents: number }[];
}

export interface Alert {
  id: string;
  categoryName: string;
  threshold: number;
  spentCents: number;
  budgetCents: number;
  createdAt: string;
}

export interface Digest {
  id: string;
  date: string;
  createdAt: string;
  payload: {
    yesterday: {
      spentCents: number;
      transactions: number;
      topCategories: { name: string; cents: number }[];
    };
    month: { safePerDayCents: number | null; remainingCents: number };
    watch: { name: string; percent: number }[];
  };
}

export interface ImportRule {
  id: string;
  pattern: string;
  categoryId: string;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  uncategorized: number;
  errors: { row: number; reason: string }[];
}

export type LiveEvent =
  | { type: 'transaction.changed'; data: { action: string; id: string } }
  | { type: 'budget.alert'; data: { categoryName: string; threshold: number } }
  | { type: 'recurring.posted'; data: { count: number } }
  | { type: 'import.completed'; data: { imported: number; skipped: number } }
  | { type: 'digest.created'; data: { date: string } }
  | { type: 'data.changed'; data: { entity: string } };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'pulse.token';

export const tokenStore = {
  get: (): string => {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (token: string): void => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Private browsing: the token simply lasts for this page load.
    }
  },
};

async function request<T>(method: string, path: string, body?: unknown, csv = false): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = csv ? 'text/csv' : 'application/json';

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : csv ? (body as string) : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (
      payload as {
        error?: { message?: string; issues?: { path: string; message: string }[] };
      } | null
    )?.error;
    const detail = error?.issues?.map((issue) => `${issue.path} ${issue.message}`).join('; ');
    throw new ApiError(
      response.status,
      detail || error?.message || `Request failed (${response.status})`,
    );
  }
  return payload as T;
}

export const api = {
  summary: (month: string | null) =>
    request<Summary>('GET', `/summary${month ? `?month=${month}` : ''}`),
  transactions: (month: string) =>
    request<Transaction[]>('GET', `/transactions?month=${month}&limit=500`),
  categories: () => request<Category[]>('GET', '/categories'),
  recurring: () => request<RecurringRule[]>('GET', '/recurring'),
  alerts: () => request<Alert[]>('GET', '/alerts?limit=10'),
  digests: () => request<Digest[]>('GET', '/digests?limit=5'),
  importRules: () => request<ImportRule[]>('GET', '/import-rules'),

  createTransaction: (body: Omit<Transaction, 'id' | 'source'>) =>
    request<Transaction>('POST', '/transactions', body),
  updateTransaction: (id: string, body: Partial<Omit<Transaction, 'id' | 'source'>>) =>
    request<Transaction>('PATCH', `/transactions/${id}`, body),
  deleteTransaction: (id: string) => request<void>('DELETE', `/transactions/${id}`),

  createCategory: (body: Omit<Category, 'id'>) => request<Category>('POST', '/categories', body),
  updateCategory: (id: string, body: Partial<Pick<Category, 'name' | 'monthlyBudgetCents'>>) =>
    request<Category>('PATCH', `/categories/${id}`, body),
  deleteCategory: (id: string) => request<void>('DELETE', `/categories/${id}`),

  createRecurring: (
    body: Omit<RecurringRule, 'id' | 'nextRun' | 'active'> & { startsOn: string },
  ) => request<RecurringRule>('POST', '/recurring', body),
  updateRecurring: (id: string, body: { active: boolean }) =>
    request<RecurringRule>('PATCH', `/recurring/${id}`, body),
  deleteRecurring: (id: string) => request<void>('DELETE', `/recurring/${id}`),

  importCsv: (text: string, positiveIsExpense: boolean) =>
    request<ImportResult>('POST', `/imports?positiveIsExpense=${positiveIsExpense}`, text, true),
  createImportRule: (body: Omit<ImportRule, 'id'>) =>
    request<ImportRule>('POST', '/import-rules', body),
  deleteImportRule: (id: string) => request<void>('DELETE', `/import-rules/${id}`),

  runAutomation: () =>
    request<{ posted?: number; digestCreated?: boolean; skipped?: boolean }>(
      'POST',
      '/automation/run',
    ),
};
