import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import { API_PREFIX, COOKIES } from '../config/constant.js';
import { assertStrongPassword } from '../utils/password.js';
import {
  issueTokens,
  signAccess,
  verifyRefresh,
  hash,
  clearRefreshCookie,
  cookieOpts,
} from '../utils/tokens.js';

const EMAIL = /^\S+@\S+\.\S+$/;

/**
 * Collects all possible refresh token candidates from body, header, and Cookie header.
 * If the browser has both a legacy `/api/v1/auth` cookie and a root `/` cookie,
 * testing all candidates ensures a stale path-specific cookie never blocks a valid root cookie!
 */
const extractRefreshCandidates = (req) => {
  const candidates = [];
  if (req.body?.refresh && typeof req.body.refresh === 'string') {
    candidates.push(req.body.refresh.trim());
  }
  if (req.headers['x-refresh-token'] && typeof req.headers['x-refresh-token'] === 'string') {
    candidates.push(req.headers['x-refresh-token'].trim());
  }
  if (req.cookies?.[COOKIES.REFRESH]) {
    candidates.push(req.cookies[COOKIES.REFRESH]);
  }
  const rawCookieHeader = req.headers?.cookie || '';
  if (rawCookieHeader) {
    for (const part of rawCookieHeader.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === COOKIES.REFRESH && rest.length) {
        try {
          candidates.push(decodeURIComponent(rest.join('=')));
        } catch {
          candidates.push(rest.join('='));
        }
      }
    }
  }
  return [...new Set(candidates.filter(Boolean))];
};

const sanitizePreferences = (raw) => {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  if (['IN', 'GLOBAL'].includes(raw.region)) out.region = raw.region;
  if (['INR', 'USD'].includes(raw.currency)) out.currency = raw.currency;
  if (Array.isArray(raw.industries)) out.industries = raw.industries.map(String).slice(0, 15);
  if (Array.isArray(raw.languages)) out.languages = raw.languages.map(String).slice(0, 15);
  if (Array.isArray(raw.genres)) out.genres = raw.genres.map(Number).filter(Number.isFinite).slice(0, 20);
  if (Array.isArray(raw.contentTypes)) out.contentTypes = raw.contentTypes.map(String).slice(0, 5);
  if (typeof raw.onboardingCompleted === 'boolean') out.onboardingCompleted = raw.onboardingCompleted;
  return Object.keys(out).length ? out : undefined;
};

// POST /auth/register -> { user, access, refresh }
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, preferences, favoriteGenres } = req.body;
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !EMAIL.test(email)) {
    throw ApiError.badRequest('A valid name and email are required');
  }
  assertStrongPassword(password);

  const cleanPrefs = sanitizePreferences(preferences);
  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
    ...(Array.isArray(favoriteGenres) ? { favoriteGenres: favoriteGenres.map(String).slice(0, 12) } : {}),
    ...(cleanPrefs ? { preferences: { ...cleanPrefs, onboardingCompleted: true } } : {}),
  });

  res.status(201).json({ user, ...(await issueTokens(user, res)) });
});

// POST /auth/login -> { user, access, refresh }
export const login = asyncHandler(async (req, res) => {
  const { email, password, preferences } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw ApiError.badRequest('Email and password are required');
  }
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

  if (user?.lockUntil > new Date()) {
    throw ApiError.locked(
      `Too many failed attempts. Try again in ${Math.ceil((user.lockUntil - Date.now()) / 60000)} min`,
    );
  }
  if (!user || !(await user.comparePassword(password))) {
    if (user) {
      const attempts = (user.loginAttempts || 0) + 1;
      await User.updateOne(
        { _id: user._id },
        attempts >= env.maxAttempts
          ? { loginAttempts: 0, lockUntil: new Date(Date.now() + env.lockMinutes * 60000) }
          : { loginAttempts: attempts },
      );
    }
    throw ApiError.unauthorized('Wrong email or password');
  }
  if (!user.isActive) {
    throw ApiError.forbidden(
      user.deactivatedReason
        ? `Your account has been deactivated: ${user.deactivatedReason}`
        : 'This account has been deactivated by an administrator',
    );
  }

  const cleanPrefs = sanitizePreferences(preferences);
  const updateDoc = {
    loginAttempts: 0,
    lockUntil: null,
    lastLoginAt: new Date(),
  };
  if (cleanPrefs && !user.preferences?.onboardingCompleted) {
    updateDoc.preferences = {
      ...(user.preferences?.toObject?.() || user.preferences || {}),
      ...cleanPrefs,
      onboardingCompleted: true,
    };
    user.preferences = updateDoc.preferences;
  }

  await User.updateOne({ _id: user._id }, updateDoc);
  res.json({ user, ...(await issueTokens(user, res)) });
});

// POST /auth/refresh -> { access, refresh, user }
export const refresh = asyncHandler(async (req, res) => {
  const candidates = extractRefreshCandidates(req);
  if (!candidates.length) throw ApiError.unauthorized('No refresh token');

  let validToken = null;
  let validUser = null;

  for (const candidate of candidates) {
    try {
      const payload = verifyRefresh(candidate);
      let user = await User.findOne({
        _id: payload.sub,
        'refreshTokens.tokenHash': hash(candidate),
      });
      if (!user) {
        user = await User.findById(payload.sub);
      }
      if (user) {
        validToken = candidate;
        validUser = user;
        break;
      }
    } catch {
      /* try next candidate */
    }
  }

  if (!validUser || !validToken) {
    throw ApiError.unauthorized('Session expired, please log in again');
  }
  if (!validUser.isActive) {
    throw ApiError.forbidden('This account has been deactivated');
  }

  // Clear any legacy path-specific cookie and refresh the root '/' cookie
  res.clearCookie(COOKIES.REFRESH, cookieOpts(`${API_PREFIX}/auth`));
  res.clearCookie(COOKIES.REFRESH, cookieOpts('/api/v1/auth'));
  res.cookie(COOKIES.REFRESH, validToken, {
    ...cookieOpts('/'),
    maxAge: env.jwt.refreshDays * 864e5,
  });

  res.json({ access: signAccess(validUser), refresh: validToken, user: validUser });
});

// POST /auth/logout -> 204
export const logout = asyncHandler(async (req, res) => {
  const candidates = extractRefreshCandidates(req);
  if (candidates.length) {
    const hashes = candidates.map((t) => hash(t));
    await User.updateMany(
      { 'refreshTokens.tokenHash': { $in: hashes } },
      { $pull: { refreshTokens: { tokenHash: { $in: hashes } } } },
    );
  }
  clearRefreshCookie(res);
  res.status(204).end();
});

// GET /auth/me -> { user }
export const getMe = (req, res) => res.json({ user: req.user });
