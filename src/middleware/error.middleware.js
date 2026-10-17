import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { logger } from '../utils/logger.js';

export const notFound = (req, _res, next) =>
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));

export const errorHandler = (err, _req, res, _next) => {
  let status = err.statusCode || 500;
  let message = err.message;

  if (err.code === 11000) {
    status = 409;
    message = err.keyPattern?.email ? 'Email already in use' : 'This record already exists';
  } else if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  } else if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid ID format';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid JSON body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  }

  if (status >= 500) {
    logger.error(err);
    if (env.isProd) message = 'Something went wrong';
  }
  res.status(status).json({ success: false, message });
};
