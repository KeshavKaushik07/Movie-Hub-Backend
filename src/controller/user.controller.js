import User from '../models/User.js';
import Review from '../models/Review.js';
import Comment from '../models/Comment.js';
import BlogComment from '../models/BlogComment.js';
import CommunityMessage from '../models/CommunityMessage.js';
import Watchlist from '../models/Watchlist.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ROLES } from '../config/constant.js';
import { assertStrongPassword } from '../utils/password.js';
import { issueTokens, clearRefreshCookie } from '../utils/tokens.js';
import { recalcSiteRating } from '../services/title.service.js';

// PATCH /users/me { name?, bio?, favoriteGenres?, preferences? } -> { user }
export const updateMe = asyncHandler(async (req, res) => {
  const updates = {};
  if (typeof req.body.name === 'string') {
    const name = req.body.name.trim();
    if (!name) throw ApiError.badRequest('Name cannot be empty');
    updates.name = name;
  }
  if (typeof req.body.bio === 'string') {
    updates.bio = req.body.bio.trim().slice(0, 300);
  }
  if (Array.isArray(req.body.favoriteGenres)) {
    updates.favoriteGenres = req.body.favoriteGenres.map(String).slice(0, 12);
  }
  if (req.body.preferences && typeof req.body.preferences === 'object') {
    const raw = req.body.preferences;
    const current = req.user.preferences?.toObject?.() || req.user.preferences || {};
    updates.preferences = {
      region: ['IN', 'GLOBAL'].includes(raw.region) ? raw.region : current.region || 'IN',
      currency: ['INR', 'USD'].includes(raw.currency) ? raw.currency : current.currency || 'INR',
      industries: Array.isArray(raw.industries) ? raw.industries.map(String).slice(0, 15) : current.industries || [],
      languages: Array.isArray(raw.languages) ? raw.languages.map(String).slice(0, 15) : current.languages || [],
      genres: Array.isArray(raw.genres) ? raw.genres.map(Number).filter(Number.isFinite).slice(0, 20) : current.genres || [],
      contentTypes: Array.isArray(raw.contentTypes) ? raw.contentTypes.map(String).slice(0, 5) : current.contentTypes || ['movie', 'webseries', 'tv'],
      onboardingCompleted: raw.onboardingCompleted !== undefined ? Boolean(raw.onboardingCompleted) : true,
    };
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
  res.json({ user });
});

// PATCH /users/me/password { currentPassword, newPassword }
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');
  if (typeof currentPassword !== 'string' || !(await user.comparePassword(currentPassword))) {
    throw ApiError.unauthorized('Current password is wrong');
  }
  assertStrongPassword(newPassword);
  user.password = newPassword;
  await user.save();
  await User.updateOne({ _id: user._id }, { refreshTokens: [] });
  res.json({ user, ...(await issueTokens(user, res)) });
});

// DELETE /users/me -> Permanently deletes current user's account (allowed for user & admin, blocked for superadmin)
export const deleteMe = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.SUPERADMIN) {
    throw ApiError.forbidden('SuperAdmin accounts are protected and cannot be deleted');
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw ApiError.notFound('User not found');

  // If password confirmation was provided, verify it
  if (req.body?.password) {
    const valid = await user.comparePassword(String(req.body.password));
    if (!valid) throw ApiError.unauthorized('Incorrect password confirmation');
  }

  const reviewedTitles = await Review.find({ user: user._id }).select('type tmdbId').lean();

  await Promise.all([
    Review.deleteMany({ user: user._id }),
    Comment.deleteMany({ user: user._id }),
    BlogComment.deleteMany({ user: user._id }),
    CommunityMessage.deleteMany({ sender: user._id }),
    Watchlist.deleteMany({ user: user._id }),
    user.deleteOne(),
  ]);

  await Promise.all(reviewedTitles.map((r) => recalcSiteRating(r.type, r.tmdbId).catch(() => null)));
  clearRefreshCookie(res);

  res.json({
    success: true,
    message: 'Your account and all associated data have been permanently deleted',
  });
});
