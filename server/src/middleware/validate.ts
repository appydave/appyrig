import { z, ZodError } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export function validate(schema: { body?: z.ZodType; query?: z.ZodType; params?: z.ZodType }) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      // Express 5: req.query is a getter — use Object.assign to mutate in place
      if (schema.query) Object.assign(req.query, schema.query.parse(req.query));
      if (schema.params) req.params = schema.params.parse(req.params);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const message = err.errors.map((e) => e.message).join('; ');
        res
          .status(400)
          .json({ status: 'error', error: message, timestamp: new Date().toISOString() });
        return;
      }
      next(err);
    }
  };
}
