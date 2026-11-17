import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import * as transactions from '../services/transactions.js';
import { cents, id, idParams, isoDate, kind, limit, month, text } from './schemas.js';

const listQuery = z.object({
  month: month.optional(),
  categoryId: id.optional(),
  limit: limit(100, 500),
});
const createBody = z.object({
  occurredOn: isoDate,
  description: text(140),
  amountCents: cents,
  kind: kind.default('expense'),
  categoryId: id.nullable().default(null),
});
const updateBody = z
  .object({
    occurredOn: isoDate,
    description: text(140),
    amountCents: cents,
    kind,
    categoryId: id.nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

export function transactionRoutes(app: FastifyInstance, { pool }: AppDeps): void {
  app.get('/api/transactions', (request) =>
    transactions.listTransactions(pool, listQuery.parse(request.query)),
  );

  app.post('/api/transactions', async (request, reply) => {
    const created = await transactions.createTransaction(pool, createBody.parse(request.body));
    return reply.status(201).send(created);
  });

  app.patch('/api/transactions/:id', (request) =>
    transactions.updateTransaction(
      pool,
      idParams.parse(request.params).id,
      updateBody.parse(request.body),
    ),
  );

  app.delete('/api/transactions/:id', async (request, reply) => {
    await transactions.deleteTransaction(pool, idParams.parse(request.params).id);
    return reply.status(204).send();
  });
}
