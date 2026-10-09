import { Router } from 'express';
import type { ServerInfo } from '@appydave/shared';
import { env } from '../config/env.js';
import { apiSuccess } from '../helpers/response.js';

const router = Router();

router.get('/api/info', (_req, res) => {
  const data: ServerInfo = {
    nodeVersion: process.version,
    environment: env.NODE_ENV,
    port: env.PORT,
    clientUrl: env.CLIENT_URL,
    uptime: process.uptime(),
  };
  apiSuccess(res, data);
});

// Example: throw new AppError(404, 'Not found') in your routes — errorHandler catches it automatically.
// router.get('/api/resource/:id', (req, res, next) => {
//   const item = findById(req.params.id);
//   if (!item) throw new AppError(404, `Resource ${req.params.id} not found`);
//   apiSuccess(res, item);
// });

export default router;
