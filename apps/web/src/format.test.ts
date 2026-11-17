import { describe, expect, it } from 'vitest';
import { parseMoney, percent, shiftMonth } from './format.ts';

describe('parseMoney', () => {
  it('converts typed amounts to exact cents', () => {
    expect(parseMoney('12')).toBe(1_200);
    expect(parseMoney('12.5')).toBe(1_250);
    expect(parseMoney('$1,250.99')).toBe(125_099);
    expect(parseMoney('0.29')).toBe(29);
  });

  it('rejects anything that is not a plain positive amount', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
    expect(parseMoney('ten')).toBeNull();
  });
});

describe('shiftMonth', () => {
  it('crosses year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('percent', () => {
  it('floors and guards against a zero budget', () => {
    expect(percent(7_999, 10_000)).toBe(79);
    expect(percent(500, 0)).toBe(0);
  });
});
