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

const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /data\s*:\s*text\/html/gi,
  /on\w+\s*=\s*["'][^"']*["']/gi,
  /on\w+\s*=\s*[^\s>]+/gi,
  /<iframe\b[^>]*>/gi,
  /<object\b[^>]*>/gi,
  /<embed\b[^>]*>/gi,
];

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const cleanString = (val) => {
  if (typeof val !== 'string') return val;
  let s = val.replace(/\0/g, '');
  for (const rx of XSS_PATTERNS) {
    s = s.replace(rx, '');
  }
  return s;
};

// Blocks NoSQL injection ($), prototype pollution, and XSS payloads in body, params, and query
const clean = (obj, depth = 0) => {
  if (depth > 10 || !obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i += 1) {
      if (typeof obj[i] === 'string') obj[i] = cleanString(obj[i]);
      else if (obj[i] && typeof obj[i] === 'object') clean(obj[i], depth + 1);
    }
    return obj;
  }
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key) || key.startsWith('$') || key.includes('.')) {
      delete obj[key];
      continue;
    }
    const val = obj[key];
    if (typeof val === 'string') {
      obj[key] = cleanString(val);
    } else if (val && typeof val === 'object') {
      clean(val, depth + 1);
    }
  }
  return obj;
};

const normalizeQueryParams = (query) => {
  if (!query || typeof query !== 'object') return;
  for (const key of Object.keys(query)) {
    if (Array.isArray(query[key])) {
      const last = query[key][query[key].length - 1];
      query[key] = typeof last === 'string' ? cleanString(last) : String(last ?? '');
    }
  }
};

export const sanitizeInput = (req, _res, next) => {
  clean(req.body);
  clean(req.params);
  clean(req.query);
  normalizeQueryParams(req.query);
  next();
};

export const sanitizeRequest = sanitizeInput;

export const securityHeaders = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=()',
  );
  next();
};
