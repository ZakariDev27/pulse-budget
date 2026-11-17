import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import * as categories from '../services/categories.js';
import { idParams, kind, text } from './schemas.js';

const budget = z.number().int().min(0).max(100_000_000_000);
const createBody = z.object({
  name: text(60),
  kind: kind.default('expense'),
  monthlyBudgetCents: budget.default(0),
});
const updateBody = z
  .object({ name: text(60), monthlyBudgetCents: budget })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

export function categoryRoutes(app: FastifyInstance, { pool }: AppDeps): void {
  app.get('/api/categories', () => categories.listCategories(pool));

  app.post('/api/categories', async (request, reply) => {
    const created = await categories.createCategory(pool, createBody.parse(request.body));
    return reply.status(201).send(created);
  });

  app.patch('/api/categories/:id', (request) =>
    categories.updateCategory(
      pool,
      idParams.parse(request.params).id,
      updateBody.parse(request.body),
    ),
  );

  app.delete('/api/categories/:id', async (request, reply) => {
    await categories.deleteCategory(pool, idParams.parse(request.params).id);
    return reply.status(204).send();
  });
}
