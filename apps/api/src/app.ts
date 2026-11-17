import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import { bearerToken, tokenMatches } from './auth.js';
import type { Config } from './config.js';
import { isForeignKeyViolation, isUniqueViolation } from './db.js';
import { CsvFormatError } from './domain/csv.js';
import { HttpError } from './errors.js';
import { categoryRoutes } from './routes/categories.js';
import { importRoutes } from './routes/imports.js';
import { insightRoutes } from './routes/insights.js';
import { liveRoutes } from './routes/live.js';
import { recurringRoutes } from './routes/recurring.js';
import { transactionRoutes } from './routes/transactions.js';

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  /** Injectable for tests. */
  clock: () => Date;
}

const errorBody = (code: string, message: string, extra: object = {}) => ({
  error: { code, message, ...extra },
});

export async function buildApp(
  options: Omit<AppDeps, 'clock'> & Partial<Pick<AppDeps, 'clock'>>,
): Promise<FastifyInstance> {
  const deps: AppDeps = { clock: () => new Date(), ...options };
  const { config, pool } = deps;

  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 5 * 1024 * 1024,
  });

  app.addContentTypeParser(
    ['text/csv', 'text/plain'],
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send(
        errorBody('invalid_request', 'Request validation failed', {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        }),
      );
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send(errorBody(error.code, error.message));
    }
    if (error instanceof CsvFormatError) {
      return reply.status(422).send(errorBody('invalid_csv', error.message));
    }
    if (isUniqueViolation(error)) {
      return reply
        .status(409)
        .send(errorBody('conflict', 'A record with that name already exists'));
    }
    if (isForeignKeyViolation(error)) {
      return reply
        .status(422)
        .send(errorBody('invalid_reference', 'A referenced record does not exist'));
    }
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      return reply.status(error.statusCode).send(errorBody('bad_request', error.message));
    }
    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send(errorBody('internal_error', 'Something went wrong'));
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send(errorBody('not_found', 'Route not found')),
  );

  // Liveness and readiness in one: the API is only useful if it can reach the database.
  app.get('/api/health', async (_request, reply) => {
    try {
      await pool.query('select 1');
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  if (config.API_TOKEN) {
    const expected = config.API_TOKEN;
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0];
      // The live feed authenticates in-band; see routes/live.ts.
      if (path === '/api/health' || path === '/api/live') return;
      if (!tokenMatches(bearerToken(request.headers.authorization), expected)) {
        return reply
          .status(401)
          .header('www-authenticate', 'Bearer')
          .send(errorBody('unauthorized', 'A valid API token is required'));
      }
    });
  }

  await app.register(websocket, { options: { maxPayload: 4096 } });

  categoryRoutes(app, deps);
  transactionRoutes(app, deps);
  recurringRoutes(app, deps);
  importRoutes(app, deps);
  insightRoutes(app, deps);
  liveRoutes(app, deps);

  return app;
}
