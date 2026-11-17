import { daysBetween, type IsoDate } from './dates.js';

export const ALERT_THRESHOLDS = [80, 100] as const;
export type AlertThreshold = (typeof ALERT_THRESHOLDS)[number];

/** Thresholds (percent of budget) that the given spend has reached. Integer math only. */
export function reachedThresholds(spentCents: number, budgetCents: number): AlertThreshold[] {
  if (budgetCents <= 0) return [];
  return ALERT_THRESHOLDS.filter((threshold) => spentCents * 100 >= budgetCents * threshold);
}

export interface SafeToSpendInput {
  budgetCents: number;
  spentCents: number;
  /** Scheduled expenses that will still post between today and the end of the month. */
  upcomingCents: number;
  today: IsoDate;
  monthEnd: IsoDate;
}

export interface SafeToSpend {
  /** Budget minus what has been spent. Negative when over budget. */
  remainingCents: number;
  /** Remaining minus scheduled bills: what is actually free to spend. Never negative. */
  availableCents: number;
  /** Days left in the month, counting today. */
  daysLeft: number;
  perDayCents: number;
}

export function safeToSpend(input: SafeToSpendInput): SafeToSpend {
  const remainingCents = input.budgetCents - input.spentCents;
  const availableCents = Math.max(0, remainingCents - input.upcomingCents);
  const daysLeft = Math.max(1, daysBetween(input.today, input.monthEnd) + 1);
  return {
    remainingCents,
    availableCents,
    daysLeft,
    perDayCents: Math.floor(availableCents / daysLeft),
  };
}
