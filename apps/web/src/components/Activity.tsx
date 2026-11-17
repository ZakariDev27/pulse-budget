import type { Alert, Digest } from '../api.ts';
import { money, shortDate } from '../format.ts';
import { Empty, Panel, Status } from './ui.tsx';

interface Props {
  alerts: Alert[];
  digests: Digest[];
  currency: string;
}

export function Activity({ alerts, digests, currency }: Props) {
  const items = [
    ...alerts.map((alert) => ({ at: alert.createdAt, alert, digest: null })),
    ...digests.map((digest) => ({ at: digest.createdAt, alert: null, digest })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Panel title="Activity">
      {items.length === 0 && (
        <Empty>Budget alerts and your morning digest will show up here.</Empty>
      )}
      <ul className="rows">
        {items.map(({ alert, digest }) =>
          alert ? (
            <li key={alert.id} className="feed">
              <Status tone={alert.threshold >= 100 ? 'critical' : 'warning'}>
                {alert.threshold}%
              </Status>
              <div>
                <div>
                  {alert.categoryName}{' '}
                  {alert.threshold >= 100 ? 'went over budget' : 'is close to its budget'}
                </div>
                <div className="muted small">
                  {money(alert.spentCents, currency)} of {money(alert.budgetCents, currency)} ·{' '}
                  {shortDate(alert.createdAt)}
                </div>
              </div>
            </li>
          ) : (
            digest && (
              <li key={digest.id} className="feed">
                <span className="tag tag-solid">Digest</span>
                <div>
                  <div>
                    {shortDate(digest.date)}: spent{' '}
                    {money(digest.payload.yesterday.spentCents, currency)}
                    {digest.payload.yesterday.transactions > 0 &&
                      ` across ${digest.payload.yesterday.transactions} transaction${digest.payload.yesterday.transactions === 1 ? '' : 's'}`}
                  </div>
                  <div className="muted small">
                    {digest.payload.month.safePerDayCents !== null
                      ? `Safe to spend ${money(digest.payload.month.safePerDayCents, currency)} per day`
                      : `${money(digest.payload.month.remainingCents, currency)} remaining`}
                    {digest.payload.watch.length > 0 &&
                      ` · watch ${digest.payload.watch.map((c) => `${c.name} ${c.percent}%`).join(', ')}`}
                  </div>
                </div>
              </li>
            )
          ),
        )}
      </ul>
    </Panel>
  );
}
