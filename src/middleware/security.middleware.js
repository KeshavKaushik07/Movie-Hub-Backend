import rateLimit from 'express-rate-limit';

const limiter = (limit, extra = {}) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later' },
    ...extra,
  });

export const apiLimiter = limiter(1500); // generous rate limit for rich UI tabs & admin dashboards
export const authLimiter = limiter(30, { skipSuccessfulRequests: true });

// Blocks NoSQL injection: removes keys starting with "$" from body, params and query
const clean = (obj) => {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$')) delete obj[key];
    else clean(obj[key]);
  }
};

export const sanitizeInput = (req, _res, next) => {
  clean(req.body);
  clean(req.params);
  clean(req.query);
  next();
};
