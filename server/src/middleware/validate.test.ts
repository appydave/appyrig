import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { validate } from './validate.js';

// Attach a catch-all error handler so unhandled errors produce a JSON body for assertions
function withErrorHandler(app: ReturnType<typeof express>) {
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ status: 'error', error: err.message });
  });
  return app;
}

const nameSchema = z.object({ name: z.string().min(1) });
const paramsSchema = z.object({ id: z.string().uuid() });

function buildBodyApp() {
  const app = express();
  app.use(express.json());
  app.post('/items', validate({ body: nameSchema }), (req, res) => {
    res.json({ received: req.body });
  });
  return withErrorHandler(app);
}

function buildParamsApp() {
  const app = express();
  app.get('/items/:id', validate({ params: paramsSchema }), (req, res) => {
    res.json({ id: req.params.id });
  });
  return withErrorHandler(app);
}

// Query-only validation: Zod parses req.query without mutating it.
// We verify invalid inputs are rejected with 400 (Zod error path).
// We do not test valid-input body passthrough here because req.query
// is a getter-only property in Express 5 / Node's IncomingMessage;
// assigning the parsed value would throw TypeError.
function buildQueryValidationApp() {
  const querySchema = z.object({ page: z.string().regex(/^\d+$/, 'must be digits only') });
  const app = express();
  app.get('/items', validate({ query: querySchema }), (_req, res) => {
    res.json({ ok: true });
  });
  return withErrorHandler(app);
}

describe('validate middleware — body', () => {
  const app = buildBodyApp();

  it('passes valid body to the route handler', async () => {
    const res = await request(app)
      .post('/items')
      .send({ name: 'Widget' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.received.name).toBe('Widget');
  });

  it('returns 400 with Zod errors when body field fails validation', async () => {
    const res = await request(app)
      .post('/items')
      .send({ name: '' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.timestamp).toBeDefined();
  });

  it('returns 400 when required body field is missing', async () => {
    const res = await request(app).post('/items').send({}).set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(typeof res.body.error).toBe('string');
  });
});

describe('validate middleware — query', () => {
  const app = buildQueryValidationApp();

  it('returns 400 with Zod errors when query parameter fails validation', async () => {
    const res = await request(app).get('/items?page=abc');

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 400 when required query parameter is missing', async () => {
    const res = await request(app).get('/items');

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
  });
});

describe('validate middleware — params', () => {
  const app = buildParamsApp();

  it('passes valid UUID param to the route handler', async () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const res = await request(app).get(`/items/${uuid}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(uuid);
  });

  it('returns 400 with Zod errors for invalid UUID param', async () => {
    const res = await request(app).get('/items/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(typeof res.body.error).toBe('string');
  });
});

// Multi-schema validation: body + query validated together in a single middleware call
const multiBodySchema = z.object({ name: z.string().min(1) });
const multiQuerySchema = z.object({ page: z.string().regex(/^\d+$/, 'must be digits only') });

function buildMultiSchemaApp() {
  const app = express();
  app.use(express.json());
  app.post('/multi', validate({ body: multiBodySchema, query: multiQuerySchema }), (req, res) => {
    res.json({ name: req.body.name, page: req.query['page'] });
  });
  return withErrorHandler(app);
}

describe('validate middleware — multi-schema (body + query)', () => {
  const app = buildMultiSchemaApp();

  it('passes when both body and query satisfy their schemas', async () => {
    const res = await request(app)
      .post('/multi?page=1')
      .send({ name: 'Widget' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Widget');
    expect(res.body.page).toBe('1');
  });

  it('returns 400 when body fails validation but query is valid', async () => {
    const res = await request(app)
      .post('/multi?page=1')
      .send({ name: '' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 400 when query fails validation but body is valid', async () => {
    const res = await request(app)
      .post('/multi?page=abc')
      .send({ name: 'Widget' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 400 when both body and query fail validation', async () => {
    const res = await request(app)
      .post('/multi?page=abc')
      .send({ name: '' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(typeof res.body.error).toBe('string');
  });
});

// Non-Zod error propagation: schema throws a plain Error → next(err) rather than 400
function buildThrowingApp() {
  const throwingSchema = {
    parse: () => {
      throw new Error('unexpected schema failure');
    },
  } as unknown as z.ZodType;

  const app = express();
  app.use(express.json());
  app.post('/throw', validate({ body: throwingSchema }), (_req, res) => {
    res.json({ ok: true });
  });
  return withErrorHandler(app);
}

describe('validate middleware — non-Zod error propagation', () => {
  const app = buildThrowingApp();

  it('calls next(err) and reaches the error handler when schema throws a plain Error', async () => {
    const res = await request(app)
      .post('/throw')
      .send({ any: 'data' })
      .set('Content-Type', 'application/json');

    // The catch-all error handler (added by withErrorHandler) returns 500 for non-Zod errors
    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toBe('unexpected schema failure');
  });
});
