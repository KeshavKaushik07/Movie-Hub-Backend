import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import env from '../config/env.js';
import { COOKIES } from '../config/constant.js';
import { assertStrongPassword } from '../utils/password.js';
import { issueTokens, signAccess, verifyRefresh, hash, clearRefreshCookie } from '../utils/tokens.js';

const EMAIL = /^\S+@\S+\.\S+$/;
// Prefer explicit body/header refresh token first (so multi-tab chat testing with 2 accounts never collides on browser cookie)
const readRefresh = (req) =>
  req.body?.refresh || req.headers['x-refresh-token'] || req.cookies?.[COOKIES.REFRESH];

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
  const token = readRefresh(req);
  if (!token) throw ApiError.unauthorized('No refresh token');
  const payload = verifyRefresh(token);

  // Find user by ID; if refreshTokens hash exists or user is valid, issue fresh access token
  let user = await User.findOne({ _id: payload.sub, 'refreshTokens.tokenHash': hash(token) });
  if (!user) {
    // Graceful fallback if token is a valid signed JWT for an active user whose array rotated
    user = await User.findById(payload.sub);
  }
  if (!user) throw ApiError.unauthorized('Session expired, please log in again');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

  res.json({ access: signAccess(user), refresh: token, user });
});

// POST /auth/logout -> 204
export const logout = asyncHandler(async (req, res) => {
  const token = readRefresh(req);
  if (token) {
    await User.updateOne(
      { 'refreshTokens.tokenHash': hash(token) },
      { $pull: { refreshTokens: { tokenHash: hash(token) } } },
    );
  }
  clearRefreshCookie(res);
  res.status(204).end();
});

// GET /auth/me -> { user }
export const getMe = (req, res) => res.json({ user: req.user });
