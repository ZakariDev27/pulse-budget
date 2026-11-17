import { z } from 'zod';

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  /** IANA zone that defines "today" for budgets, bills and the digest. */
  APP_TZ: z
    .string()
    .default('America/New_York')
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, 'must be a valid IANA time zone'),
  CURRENCY: z.string().length(3).default('USD'),
  /** When set, every API and WebSocket request must present this token. */
  API_TOKEN: optional(z.string().min(16, 'must be at least 16 characters')),
  /** Cron expression, evaluated in APP_TZ, for the daily automation run. */
  DAILY_CRON: z.string().default('0 6 * * *'),
  /** Optional Slack- or Discord-compatible webhook that receives the daily digest. */
  DIGEST_WEBHOOK_URL: optional(z.url()),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}
