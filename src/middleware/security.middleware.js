/**
 * Enterprise Backend Security Middleware (Requirement 3)
 * 1. Recursive NoSQL Injection ($gt, $ne, $where) & Prototype Pollution
 *    (__proto__, constructor, prototype) key stripper.
 * 2. Recursive XSS payload sanitizer (<script>, javascript:, event handlers,
 *    <iframe>, <object>) across req.body, req.query, and req.params.
 * 3. HTTP Parameter Pollution (HPP) guard so array query tricks (?q[]=a&q[]=b)
 *    cannot crash string methods in controllers.
 * 4. Strict HTTP Security Headers (X-Content-Type-Options, X-Frame-Options,
 *    Referrer-Policy, Permissions-Policy).
 */

import rateLimit from 'express-rate-limit';

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

const cleanObject = (obj, depth = 0) => {
  if (depth > 10 || !obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i += 1) {
      if (typeof obj[i] === 'string') obj[i] = cleanString(obj[i]);
      else if (obj[i] && typeof obj[i] === 'object')
        cleanObject(obj[i], depth + 1);
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
      cleanObject(val, depth + 1);
    }
  }
  return obj;
};

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // Maximum 10 attempts per IP per window
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.',
  },
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

/**
 * Normalizes query parameters so unexpected arrays from HTTP Parameter Pollution
 * (?page=1&page=2 or ?q[]=foo) are safely collapsed to their last string value.
 */
const normalizeQueryParams = (query) => {
  if (!query || typeof query !== 'object') return;
  for (const key of Object.keys(query)) {
    if (Array.isArray(query[key])) {
      const last = query[key][query[key].length - 1];
      query[key] =
        typeof last === 'string' ? cleanString(last) : String(last ?? '');
    }
  }
};

export const sanitizeRequest = (req, _res, next) => {
  cleanObject(req.body);
  cleanObject(req.query);
  cleanObject(req.params);
  normalizeQueryParams(req.query);
  next();
};

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
