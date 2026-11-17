import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { HttpError } from '../errors.js';
import * as imports from '../services/imports.js';
import { id, idParams, text } from './schemas.js';

const importQuery = z.object({
  positiveIsExpense: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
const ruleBody = z.object({ pattern: text(80), categoryId: id });

export function importRoutes(app: FastifyInstance, { pool }: AppDeps): void {
  // Send the file as the raw request body with Content-Type: text/csv.
  app.post('/api/imports', (request) => {
    if (typeof request.body !== 'string' || request.body.trim() === '') {
      throw new HttpError(400, 'invalid_request', 'Send the CSV file as a text/csv request body.');
    }
    return imports.importCsv(pool, request.body, importQuery.parse(request.query));
  });

  app.get('/api/import-rules', () => imports.listImportRules(pool));

  app.post('/api/import-rules', async (request, reply) => {
    const created = await imports.createImportRule(pool, ruleBody.parse(request.body));
    return reply.status(201).send(created);
  });

  app.delete('/api/import-rules/:id', async (request, reply) => {
    await imports.deleteImportRule(pool, idParams.parse(request.params).id);
    return reply.status(204).send();
  });
}
