import rateLimit from 'express-rate-limit';

// One person's browser loads the built client's assets, and agents poll the API: the scaffold's
// 100 per 15 min would 429 the second page reload. This is a per-IP ceiling against a runaway loop.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
