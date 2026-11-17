import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import * as recurring from '../services/recurring.js';
import { cadence, cents, id, idParams, isoDate, kind, text } from './schemas.js';

const createBody = z.object({
  description: text(140),
  amountCents: cents,
  kind: kind.default('expense'),
  categoryId: id.nullable().default(null),
  cadence,
  startsOn: isoDate,
});
const updateBody = z
  .object({ active: z.boolean(), amountCents: cents, description: text(140) })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

export function recurringRoutes(app: FastifyInstance, { pool }: AppDeps): void {
  app.get('/api/recurring', () => recurring.listRecurring(pool));

  app.post('/api/recurring', async (request, reply) => {
    const created = await recurring.createRecurring(pool, createBody.parse(request.body));
    return reply.status(201).send(created);
  });

  app.patch('/api/recurring/:id', (request) =>
    recurring.updateRecurring(
      pool,
      idParams.parse(request.params).id,
      updateBody.parse(request.body),
    ),
  );

  app.delete('/api/recurring/:id', async (request, reply) => {
    await recurring.deleteRecurring(pool, idParams.parse(request.params).id);
    return reply.status(204).send();
  });
}
