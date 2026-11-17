import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time comparison. Hashing first equalizes length, so nothing leaks through timing. */
export function tokenMatches(presented: unknown, expected: string): boolean {
  return typeof presented === 'string' && timingSafeEqual(digest(presented), digest(expected));
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer (.+)$/i.exec(header ?? '');
  return match?.[1];
}
