import User from '../models/User.js';
import Title from '../models/Title.js';
import Review from '../models/Review.js';
import Comment from '../models/Comment.js';
import Watchlist from '../models/Watchlist.js';
import Featured from '../models/Featured.js';
import Blog from '../models/Blog.js';
import BlogComment from '../models/BlogComment.js';
import CommunityRoom from '../models/CommunityRoom.js';
import CommunityMessage from '../models/CommunityMessage.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { recalcSiteRating as recalculateRatings, titlesByPairs } from '../services/title.service.js';
import { getCrawlerStatus } from '../services/crawler.service.js';
import { TOP_LEVEL_POST_FILTER, recalculateRoomPostCount } from './community.controller.js';

export const getStats = asyncHandler(async (_req, res) => {
  const [
    users,
    activeUsers,
    admins,
    titles,
    movies,
    tvShows,
    webSeries,
    enrichedTitles,
    userReviews,
    criticReviews,
    comments,
    watchlists,
    featuredHeroCount,
    blogsCount,
    blogCommentsCount,
    communityRoomsCount,
    communityMessagesCount,
    recentUsers,
    topReviewed,
    byDecade,
    byIndustry,
    byOtt,
    crawler,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isActive: true }),
    User.countDocuments({ role: { $in: ['admin', 'superadmin'] } }),
    Title.countDocuments(),
    Title.countDocuments({ mediaType: 'movie' }),
    Title.countDocuments({ mediaType: 'tv' }),
    Title.countDocuments({ $or: [{ isWebSeries: true }, { subType: 'webseries' }] }),
    Title.countDocuments({ detailsFetched: true }),
    Review.countDocuments({ reviewType: 'user' }),
    Review.countDocuments({ reviewType: 'critic' }),
    Comment.countDocuments(),
    Watchlist.countDocuments(),
    Featured.countDocuments(),
    Blog.countDocuments(),
    BlogComment.countDocuments({ isHidden: { $ne: true } }),
    CommunityRoom.countDocuments({ roomType: 'public', isActive: true }),
    CommunityMessage.countDocuments(TOP_LEVEL_POST_FILTER),
    User.find().sort('-createdAt').limit(8),
    Title.find({ siteReviewCount: { $gt: 0 } })
      .sort({ siteReviewCount: -1, siteRating: -1 })
      .limit(8)
      .select('tmdbId mediaType subType title year siteRating siteReviewCount criticRating posterPath'),
    Title.aggregate([
      { $match: { year: { $gte: 1950 } } },
      { $project: { decade: { $subtract: ['$year', { $mod: ['$year', 10] }] } } },
      { $group: { _id: '$decade', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]),
    Title.aggregate([
      { $unwind: '$regions' },
      { $group: { _id: '$regions', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Title.aggregate([
      { $unwind: '$ottProviders' },
      { $group: { _id: '$ottProviders', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    getCrawlerStatus(),
  ]);

  res.json({
    success: true,
    counts: {
      users,
      activeUsers,
      deactivatedUsers: users - activeUsers,
      admins,
      titles,
      movies,
      tvShows,
      webSeries,
      enrichedTitles,
      reviews: userReviews + criticReviews,
      userReviews,
      criticReviews,
      comments,
      watchlists,
      featuredHeroCount,
      blogsCount,
      blogCommentsCount,
      communityRoomsCount,
      communityMessagesCount,
    },
    byDecade,
    byIndustry,
    byOtt,
    recentUsers,
    topReviewed,
    crawler,
  });
});

export const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const filter = {};

  if (req.query.q) {
    const q = String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
    ];
  }
  if (req.query.role) filter.role = req.query.role;
  if (req.query.active !== undefined && req.query.active !== '') {
    filter.isActive = req.query.active === 'true';
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    users,
    page,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  });
});

/**
 * Helper: When a user is blocked/suspended or deleted by Admin, remove all of their
 * community posts & replies completely and recalculate affected rooms' post counts.
 */
const purgeBlockedUserCommunityActivity = async (userId) => {
  const userMsgs = await CommunityMessage.find({ sender: userId }).select('_id room').lean();
  const affectedRoomIds = new Set(userMsgs.map((m) => String(m.room)));
  const userMsgIds = userMsgs.map((m) => m._id);

  if (userMsgIds.length > 0) {
    await CommunityMessage.deleteMany({
      $or: [{ sender: userId }, { 'replyTo.messageId': { $in: userMsgIds } }],
    });
  }

  const memberRooms = await CommunityRoom.find({
    $or: [{ members: userId }, { admins: userId }],
  }).select('_id members admins createdBy blockedUsers');

  for (const r of memberRooms) {
    affectedRoomIds.add(String(r._id));
    r.members = (r.members || []).filter((id) => String(id) !== String(userId));
    r.admins = (r.admins || []).filter((id) => String(id) !== String(userId));
    if (r.createdBy && String(r.createdBy) === String(userId)) {
      r.createdBy = r.admins[0] || r.members[0] || null;
      if (r.createdBy && r.admins.length === 0) {
        r.admins = [r.createdBy];
      }
    }
    r.memberCount = r.members.length;
    await r.save();
  }

  await Promise.all(Array.from(affectedRoomIds).map((rid) => recalculateRoomPostCount(rid)));
};

export const setActive = asyncHandler(async (req, res) => {
  const { isActive, reason = '' } = req.body;
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found');

  if (String(target._id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot deactivate your own account');
  }
  if (target.role === 'superadmin') {
    throw ApiError.forbidden('Superadmin accounts cannot be deactivated');
  }
  if (target.role === 'admin' && req.user.role !== 'superadmin') {
    throw ApiError.forbidden('Only a superadmin can activate or deactivate admin accounts');
  }

  target.isActive = Boolean(isActive);
  target.deactivatedReason = target.isActive ? '' : String(reason).slice(0, 200);
  if (!target.isActive) {
    target.refreshTokens = [];
  }
  await target.save();

  // If user is blocked/suspended by Admin, completely delete all their community posts
  if (!target.isActive) {
    await purgeBlockedUserCommunityActivity(target._id);
  }

  res.json({ success: true, user: target });
});

export const setRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin', 'superadmin'].includes(role)) {
    throw ApiError.badRequest("Role must be 'user', 'admin', or 'superadmin'");
  }
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found');
  if (target.role === 'superadmin') {
    throw ApiError.forbidden('Superadmin role cannot be modified');
  }
  target.role = role;
  await target.save();
  res.json({ success: true, user: target });
});

export const adminChangeUserPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  const cleanPassword = String(newPassword || '').trim();
  if (cleanPassword.length < 6) {
    throw ApiError.badRequest('New password must be at least 6 characters long');
  }

  const target = await User.findById(req.params.id).select('+password +refreshTokens');
  if (!target) throw ApiError.notFound('User not found');

  if (target.role !== 'user' && req.user.role !== 'superadmin') {
    throw ApiError.forbidden('Only a SuperAdmin can change an Admin or SuperAdmin password');
  }

  target.password = cleanPassword;
  target.loginAttempts = 0;
  target.lockUntil = undefined;
  target.refreshTokens = [];
  await target.save();

  res.json({
    success: true,
    message: `Password updated for ${target.name}`,
    user: target,
  });
});

export const removeUser = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found');
  if (target.role === 'superadmin') {
    throw ApiError.forbidden('Superadmin cannot be deleted');
  }
  if (target.role === 'admin' && req.user.role !== 'superadmin') {
    throw ApiError.forbidden('Only superadmin can delete an admin account');
  }

  await Promise.all([
    target.deleteOne(),
    Review.deleteMany({ user: target._id }),
    Comment.deleteMany({ user: target._id }),
    Watchlist.deleteMany({ user: target._id }),
    purgeBlockedUserCommunityActivity(target._id),
  ]);

  res.json({ success: true, message: 'User and associated activity deleted' });
});

export const listAllReviews = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 40;
  const filter = {};
  if (req.query.reviewType) filter.reviewType = req.query.reviewType;
  if (req.query.hidden !== undefined && req.query.hidden !== '') {
    filter.isHidden = req.query.hidden === 'true';
  }

  const [items, total] = await Promise.all([
    Review.find(filter)
      .populate('user', 'name email role avatarColor')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit),
    Review.countDocuments(filter),
  ]);

  const pairs = items.map((r) => ({ type: r.type, tmdbId: r.tmdbId }));
  const titleMap = await titlesByPairs(pairs);

  const enriched = items.map((r) => {
    const obj = r.toObject ? r.toObject() : r;
    const tObj = titleMap.get(`${r.type}:${r.tmdbId}`) || null;
    return {
      ...obj,
      id: String(obj._id || obj.id),
      headline: obj.headline || obj.title || '',
      text: obj.text || obj.body || '',
      movieTitle: tObj?.title || `${r.type.toUpperCase()} #${r.tmdbId}`,
      moviePoster: tObj?.posterUrl || '',
      movieYear: tObj?.year || '',
      titleObj: tObj,
    };
  });

  res.json({
    success: true,
    reviews: enriched,
    page,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  });
});

export const moderateReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id).populate('user', 'name email role avatarColor');
  if (!review) throw ApiError.notFound('Review not found');

  const {
    isHidden,
    isFeatured,
    spoiler,
    rating,
    headline,
    title,
    text,
    body,
    criticName,
    publication,
    externalUrl,
  } = req.body;

  if (typeof isHidden === 'boolean') review.isHidden = isHidden;
  if (typeof isFeatured === 'boolean') review.isFeatured = isFeatured;
  if (typeof spoiler === 'boolean') review.spoiler = spoiler;
  if (rating !== undefined) review.rating = Math.min(10, Math.max(1, Number(rating)));
  if (headline !== undefined || title !== undefined) {
    review.headline = String(headline ?? title ?? '').trim();
  }
  if (text !== undefined || body !== undefined) {
    review.text = String(text ?? body ?? '').trim();
  }
  if (criticName !== undefined) review.criticName = String(criticName).trim();
  if (publication !== undefined) review.publication = String(publication).trim();
  if (externalUrl !== undefined) review.externalUrl = String(externalUrl).trim();

  await review.save();
  await recalculateRatings(review.type, review.tmdbId);

  const titleMap = await titlesByPairs([{ type: review.type, tmdbId: review.tmdbId }]);
  const tObj = titleMap.get(`${review.type}:${review.tmdbId}`) || null;
  const obj = review.toObject();

  res.json({
    success: true,
    message: 'Review updated',
    review: {
      ...obj,
      id: String(obj._id),
      movieTitle: tObj?.title || `${review.type.toUpperCase()} #${review.tmdbId}`,
      moviePoster: tObj?.posterUrl || '',
      movieYear: tObj?.year || '',
      titleObj: tObj,
    },
  });
});

export const adminDeleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');
  const { type, tmdbId } = review;
  await review.deleteOne();
  await recalculateRatings(type, tmdbId);
  res.json({ success: true, message: 'Review removed' });
});

export const listAllComments = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 30;
  const filter = {};
  if (req.query.hidden !== undefined && req.query.hidden !== '') {
    filter.isHidden = req.query.hidden === 'true';
  }

  const [items, total] = await Promise.all([
    Comment.find(filter)
      .populate('user', 'name email role avatarColor')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit),
    Comment.countDocuments(filter),
  ]);

  const pairs = items.map((c) => ({ type: c.type, tmdbId: c.tmdbId }));
  const titleMap = await titlesByPairs(pairs);
  const enrichedComments = items.map((c) => {
    const obj = c.toObject ? c.toObject() : c;
    const tObj = titleMap.get(`${c.type}:${c.tmdbId}`) || null;
    return {
      ...obj,
      id: String(obj._id || obj.id),
      movieTitle: tObj?.title || `${c.type.toUpperCase()} #${c.tmdbId}`,
      moviePoster: tObj?.posterUrl || '',
      movieYear: tObj?.year || '',
    };
  });

  res.json({
    success: true,
    comments: enrichedComments,
    page,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  });
});

export const moderateComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw ApiError.notFound('Comment not found');

  const { isHidden, isPinned, spoiler, body } = req.body;
  if (typeof isHidden === 'boolean') comment.isHidden = isHidden;
  if (typeof isPinned === 'boolean') comment.isPinned = isPinned;
  if (typeof spoiler === 'boolean') comment.spoiler = spoiler;
  if (body !== undefined) comment.body = String(body).trim();

  await comment.save();
  res.json({ success: true, comment });
});

export const adminDeleteComment = asyncHandler(async (req, res) => {
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw ApiError.notFound('Comment not found');
  await Comment.deleteMany({ $or: [{ _id: comment._id }, { parent: comment._id }] });
  res.json({ success: true, message: 'Comment thread deleted' });
});
