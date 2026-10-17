import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import { API_PREFIX, COOKIES } from '../config/constant.js';
import User from '../models/User.js';
import ApiError from './ApiError.js';

export const signAccess = (u) =>
  jwt.sign({ sub: u.id, role: u.role }, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl });

export const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

export const verifyRefresh = (token) => {
  try {
    return jwt.verify(token, env.jwt.refreshSecret);
  } catch {
    throw ApiError.unauthorized('Session expired, please log in again');
  }
};

const cookieOpts = () => ({
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.cookie.sameSite,
  domain: env.cookie.domain,
  path: `${API_PREFIX}/auth`,
});

export const clearRefreshCookie = (res) => res.clearCookie(COOKIES.REFRESH, cookieOpts());

export const issueTokens = async (user, res) => {
  const access = signAccess(user);
  const refresh = jwt.sign({ sub: user.id, jti: crypto.randomUUID() }, env.jwt.refreshSecret, {
    expiresIn: `${env.jwt.refreshDays}d`,
  });
  const expiresAt = new Date(Date.now() + env.jwt.refreshDays * 864e5);
  await User.updateOne(
    { _id: user._id },
    { $push: { refreshTokens: { $each: [{ tokenHash: hash(refresh), expiresAt }], $slice: -5 } } },
  );
  res.cookie(COOKIES.REFRESH, refresh, { ...cookieOpts(), maxAge: env.jwt.refreshDays * 864e5 });
  return { access, refresh };
};
