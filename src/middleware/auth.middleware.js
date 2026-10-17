import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { COOKIES } from '../config/constant.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';

const extractToken = (req) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.[COOKIES.ACCESS] || null;
};

const authenticate = async (token) => {
  let payload;
  try {
    payload = jwt.verify(token, env.jwt.accessSecret);
  } catch (err) {
    throw ApiError.unauthorized(err.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token');
  }
  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('User no longer exists');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated by an administrator');
  return user;
};

/** Requires a valid access token and active account. Sets req.user. */
export const protect = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized();
  req.user = await authenticate(token);
  next();
});

/** Sets req.user if a valid token is sent, but never blocks (guests allowed). */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = await authenticate(token);
    } catch {
      /* treated as guest */
    }
  }
  next();
});

/** Use after protect: authorize('admin', 'superadmin') */
export const authorize = (...roles) => (req, _res, next) =>
  roles.includes(req.user.role) ? next() : next(ApiError.forbidden());
