import pg from 'pg';
import type { Db } from './db.js';

const CHANNEL = 'pulse_events';

export interface PulseEventMap {
  'transaction.changed': { action: 'created' | 'updated' | 'deleted'; id: string };
  'budget.alert': {
    categoryId: string;
    categoryName: string;
    threshold: number;
    spentCents: number;
    budgetCents: number;
  };
  'recurring.posted': { count: number };
  'import.completed': { imported: number; skipped: number };
  'digest.created': { date: string };
  'data.changed': { entity: 'category' | 'recurring' | 'import-rule' };
}

export type PulseEvent = {
  [Type in keyof PulseEventMap]: { type: Type; at: string; data: PulseEventMap[Type] };
}[keyof PulseEventMap];

/**
 * Publishes through Postgres NOTIFY. Two properties make this the right bus here:
 * a notification sent inside a transaction is delivered only if it commits, and the
 * worker container can reach every API replica without a separate broker.
 */
export async function publish<Type extends keyof PulseEventMap>(
  db: Db,
  type: Type,
  data: PulseEventMap[Type],
): Promise<void> {
  const event = { type, at: new Date().toISOString(), data };
  await db.query('select pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)]);
}

interface ListenerLogger {
  info(message: string): void;
  warn(details: object, message: string): void;
}

/** Holds one dedicated connection on LISTEN and reconnects with backoff if it drops. */
export class EventListener {
  private client: pg.Client | null = null;
  private retry: NodeJS.Timeout | null = null;
  private attempts = 0;
  private closed = false;

  constructor(
    private readonly connectionString: string,
    private readonly onEvent: (event: PulseEvent) => void,
    private readonly log: ListenerLogger,
  ) {}

  async start(): Promise<void> {
    try {
      await this.connect();
    } catch (error) {
      this.scheduleReconnect(error);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    await this.client?.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on('notification', (message) => {
      if (!message.payload) return;
      try {
        this.onEvent(JSON.parse(message.payload) as PulseEvent);
      } catch (error) {
        this.log.warn({ err: error }, 'Dropped malformed event');
      }
    });
    const lost = (error?: Error) => {
      if (this.client !== client) return;
      this.client = null;
      this.scheduleReconnect(error);
    };
    client.on('error', lost);
    client.on('end', () => lost());

    await client.connect();
    await client.query(`listen ${CHANNEL}`);
    this.client = client;
    this.attempts = 0;
    this.log.info('Listening for events');
  }

  private scheduleReconnect(error: unknown): void {
    if (this.closed || this.retry) return;
    const delay = Math.min(30_000, 500 * 2 ** this.attempts++);
    this.log.warn({ err: error, delay }, 'Event listener disconnected, retrying');
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.start();
    }, delay);
  }
}
