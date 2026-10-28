import User from '../models/User.js';
import Review from '../models/Review.js';
import Title from '../models/Title.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { parseTitle } from '../utils/title.js';
import { ROLES } from '../config/constant.js';
import {
  getOrFetchTitle,
  recalcSiteRating,
  titlesByPairs,
} from '../services/title.service.js';

const sanitizeExternalUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed)) return `https://${trimmed}`;
  return '';
};

const shape = (r, uid) => ({
  id: r.id || String(r._id),
  tmdbId: r.tmdbId,
  type: r.type,
  reviewType: r.reviewType || 'user',
  rating: r.rating,
  headline: r.headline || '',
  text: r.text || '',
  spoiler: !!r.spoiler,
  criticName: r.criticName || '',
  publication: r.publication || '',
  externalUrl: sanitizeExternalUrl(r.externalUrl),
  isVerifiedCritic: !!r.isVerifiedCritic,
  isFeatured: !!r.isFeatured,
  isHidden: !!r.isHidden,
  likeCount: (r.likes || []).length,
  liked: !!uid && (r.likes || []).some((l) => l.equals(uid)),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  user: r.user && {
    id: r.user.id || String(r.user._id),
    name: r.user.name,
    avatarColor: r.user.avatarColor,
    role: r.user.role,
  },
});

const withUser = (q) => q.populate('user', 'name avatarColor role');

// GET /titles/:type/:tmdbId/reviews -> { reviews, criticReviews, tmdbReviews, stats, mine }
export const listReviews = asyncHandler(async (req, res) => {
  const parsed = parseTitle(req);
  const resolvedDoc = parsed.isSlug
    ? await getOrFetchTitle(parsed.type, parsed.slug)
    : null;
  const f = {
    type: resolvedDoc?.mediaType || parsed.type,
    tmdbId: resolvedDoc?.tmdbId || parsed.tmdbId,
  };
  const [userReviews, criticReviews, aggUser, aggCritic, mine, titleDoc] =
    await Promise.all([
      withUser(
        Review.find({
          ...f,
          reviewType: { $ne: 'critic' },
          isHidden: { $ne: true },
        })
          .sort('-isFeatured -createdAt')
          .limit(100),
      ),
      withUser(
        Review.find({ ...f, reviewType: 'critic', isHidden: { $ne: true } })
          .sort('-isFeatured -createdAt')
          .limit(50),
      ),
      Review.aggregate([
        {
          $match: {
            ...f,
            reviewType: { $ne: 'critic' },
            isHidden: { $ne: true },
          },
        },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
      Review.aggregate([
        { $match: { ...f, reviewType: 'critic', isHidden: { $ne: true } } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
      req.user
        ? withUser(
            Review.findOne({
              ...f,
              user: req.user._id,
              reviewType: { $ne: 'critic' },
            }),
          )
        : null,
      Title.findOne({ mediaType: f.type, tmdbId: f.tmdbId })
        .select('tmdbReviews')
        .lean(),
    ]);

  res.json({
    reviews: userReviews.map((r) => shape(r, req.user?._id)),
    criticReviews: criticReviews.map((r) => shape(r, req.user?._id)),
    tmdbReviews: titleDoc?.tmdbReviews || [],
    stats: {
      average: aggUser[0] ? Math.round(aggUser[0].avg * 10) / 10 : 0,
      count: aggUser[0]?.count || 0,
      criticAverage: aggCritic[0] ? Math.round(aggCritic[0].avg * 10) / 10 : 0,
      criticCount: aggCritic[0]?.count || 0,
    },
    mine: mine ? shape(mine, req.user?._id) : null,
  });
});

// PUT /titles/:type/:tmdbId/reviews { rating, headline?, text?, spoiler? } -> { review }
export const saveReview = asyncHandler(async (req, res) => {
  const parsed = parseTitle(req);
  const resolvedDoc = parsed.isSlug
    ? await getOrFetchTitle(parsed.type, parsed.slug)
    : null;
  const f = {
    type: resolvedDoc?.mediaType || parsed.type,
    tmdbId: resolvedDoc?.tmdbId || parsed.tmdbId,
  };
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    throw ApiError.badRequest('Rating must be a whole number from 1 to 10');
  }
  await getOrFetchTitle(f.type, f.tmdbId);
  const review = await withUser(
    Review.findOneAndUpdate(
      { ...f, user: req.user._id, reviewType: 'user' },
      {
        rating,
        headline:
          typeof req.body.headline === 'string'
            ? req.body.headline.trim().slice(0, 160)
            : '',
        text:
          typeof req.body.text === 'string'
            ? req.body.text.trim().slice(0, 4000)
            : '',
        spoiler: Boolean(req.body.spoiler),
        reviewType: 'user',
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    ),
  );
  await recalcSiteRating(f.type, f.tmdbId);
  res.json({ review: shape(review, req.user._id) });
});

// POST /titles/:type/:tmdbId/critic-reviews (Admin & SuperAdmin)
export const addCriticReview = asyncHandler(async (req, res) => {
  const parsed = parseTitle(req);
  const resolvedDoc = parsed.isSlug
    ? await getOrFetchTitle(parsed.type, parsed.slug)
    : null;
  const f = {
    type: resolvedDoc?.mediaType || parsed.type,
    tmdbId: resolvedDoc?.tmdbId || parsed.tmdbId,
  };
  const rating = Number(req.body.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
    throw ApiError.badRequest('Critic rating must be between 1 and 10');
  }
  const criticName = String(req.body.criticName || req.user.name || '').trim();
  const publication = String(
    req.body.publication || 'Movies Hub Critics',
  ).trim();
  const text = String(req.body.text || '').trim();
  if (!text) throw ApiError.badRequest('Critic review text is required');

  await getOrFetchTitle(f.type, f.tmdbId);
  const review = await Review.create({
    ...f,
    user: req.user._id,
    reviewType: 'critic',
    rating,
    criticName,
    publication,
    headline: String(req.body.headline || '').trim(),
    text,
    externalUrl: sanitizeExternalUrl(req.body.externalUrl),
    isVerifiedCritic: true,
    isFeatured: Boolean(req.body.isFeatured),
  });
  await review.populate('user', 'name avatarColor role');
  await recalcSiteRating(f.type, f.tmdbId);
  res.status(201).json({ review: shape(review, req.user._id) });
});

// POST /reviews/:id/like
export const toggleReviewLike = asyncHandler(async (req, res) => {
  const had = await Review.exists({ _id: req.params.id, likes: req.user._id });
  const r = await Review.findByIdAndUpdate(
    req.params.id,
    had
      ? { $pull: { likes: req.user._id } }
      : { $addToSet: { likes: req.user._id } },
    { new: true },
  );
  if (!r) throw ApiError.notFound('Review not found');
  res.json({ likeCount: r.likes.length, liked: !had });
});

// DELETE /reviews/:id (owner, admin, or superadmin)
export const deleteReview = asyncHandler(async (req, res) => {
  const r = await Review.findById(req.params.id);
  if (!r) throw ApiError.notFound('Review not found');
  if (!r.user.equals(req.user._id) && req.user.role === ROLES.USER)
    throw ApiError.forbidden();
  const author = await User.findById(r.user).select('role');
  if (author?.role === 'superadmin' && req.user.role !== ROLES.SUPERADMIN) {
    throw ApiError.forbidden('Cannot delete content created by a Super Admin');
  }
  await r.deleteOne();
  await recalcSiteRating(r.type, r.tmdbId);
  res.status(204).end();
});

// GET /users/me/reviews
export const myReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ user: req.user._id })
    .sort('-updatedAt')
    .limit(100);
  const titles = await titlesByPairs(
    reviews.map((r) => ({ type: r.type, tmdbId: r.tmdbId })),
  );
  res.json({
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      headline: r.headline,
      text: r.text,
      reviewType: r.reviewType,
      createdAt: r.createdAt,
      title: titles.get(`${r.type}:${r.tmdbId}`) || null,
    })),
  });
});

export { recalcSiteRating as recalculateRatings } from '../services/title.service.js';
