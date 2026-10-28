import User from '../models/User.js';
import Comment from '../models/Comment.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { parseTitle } from '../utils/title.js';
import { ROLES } from '../config/constant.js';
import { getOrFetchTitle } from '../services/title.service.js';

const shape = (c, uid) => ({
  id: c.id || String(c._id),
  text: c.text,
  spoiler: !!c.spoiler,
  isPinned: !!c.isPinned,
  isHidden: !!c.isHidden,
  parent: c.parent ? String(c.parent) : null,
  createdAt: c.createdAt,
  user: c.user && {
    id: c.user.id || String(c.user._id),
    name: c.user.name,
    avatarColor: c.user.avatarColor,
    role: c.user.role,
  },
  likeCount: (c.likes || []).length,
  liked: !!uid && (c.likes || []).some((l) => l.equals(uid)),
});

const withUser = (q) => q.populate('user', 'name avatarColor role');

// GET /titles/:type/:tmdbId/comments
export const listComments = asyncHandler(async (req, res) => {
  const parsed = parseTitle(req);
  const resolvedDoc = parsed.isSlug ? await getOrFetchTitle(parsed.type, parsed.slug) : null;
  const f = { type: resolvedDoc?.mediaType || parsed.type, tmdbId: resolvedDoc?.tmdbId || parsed.tmdbId };
  const list = await withUser(
    Comment.find({ ...f, isHidden: { $ne: true } })
      .sort('-isPinned createdAt')
      .limit(300),
  );
  res.json({ comments: list.map((c) => shape(c, req.user?._id)) });
});

// POST /titles/:type/:tmdbId/comments { text, parent?, spoiler? }
export const addComment = asyncHandler(async (req, res) => {
  const parsed = parseTitle(req);
  const resolvedDoc = parsed.isSlug ? await getOrFetchTitle(parsed.type, parsed.slug) : null;
  const f = { type: resolvedDoc?.mediaType || parsed.type, tmdbId: resolvedDoc?.tmdbId || parsed.tmdbId };
  if (typeof req.body.text !== 'string' || !req.body.text.trim()) {
    throw ApiError.badRequest('Comment text is required');
  }
  await getOrFetchTitle(f.type, f.tmdbId);
  let parent = null;
  if (req.body.parent) {
    const p = await Comment.findOne({ _id: req.body.parent, ...f });
    if (!p) throw ApiError.notFound('Comment to reply to was not found');
    parent = p.parent || p._id;
  }
  const c = await Comment.create({
    ...f,
    user: req.user._id,
    text: req.body.text.trim(),
    parent,
    spoiler: Boolean(req.body.spoiler),
  });
  await c.populate('user', 'name avatarColor role');
  res.status(201).json({ comment: shape(c, req.user._id) });
});

// DELETE /comments/:id (owner, admin, or superadmin)
export const deleteComment = asyncHandler(async (req, res) => {
  const c = await Comment.findById(req.params.id);
  if (!c) throw ApiError.notFound('Comment not found');
  if (!c.user.equals(req.user._id) && req.user.role === ROLES.USER) throw ApiError.forbidden();
  const author = await User.findById(c.user).select('role');
  if (author?.role === 'superadmin' && req.user.role !== ROLES.SUPERADMIN) {
    throw ApiError.forbidden('Cannot delete content created by a Super Admin');
  }
  await Comment.deleteMany({ $or: [{ _id: c._id }, { parent: c._id }] });
  res.status(204).end();
});

// POST /comments/:id/like
export const toggleLike = asyncHandler(async (req, res) => {
  const had = await Comment.exists({ _id: req.params.id, likes: req.user._id });
  const c = await Comment.findByIdAndUpdate(
    req.params.id,
    had ? { $pull: { likes: req.user._id } } : { $addToSet: { likes: req.user._id } },
    { new: true },
  );
  if (!c) throw ApiError.notFound('Comment not found');
  res.json({ likeCount: c.likes.length, liked: !had });
});
