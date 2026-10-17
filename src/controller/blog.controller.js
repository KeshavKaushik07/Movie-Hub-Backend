import mongoose from 'mongoose';
import Blog from '../models/Blog.js';
import BlogComment from '../models/BlogComment.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getOrFetchTitle, shapeDetail } from '../services/title.service.js';

const imgUrl = (p, size = 'w780') => {
  if (!p) return null;
  if (String(p).startsWith('http://') || String(p).startsWith('https://')) return p;
  return `${env.tmdb.imageBase}/${size}${p}`;
};

const makeSlug = (title) => {
  const base = String(title || 'blog-post')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  const suffix = Date.now().toString(36).slice(-5);
  return `${base || 'post'}-${suffix}`;
};

const estimateReadTime = (content = '') => {
  const words = String(content).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
};

/**
 * Resolves a Movie / TV Show / Web Series by (mediaType, tmdbId) from MongoDB (or TMDB if not cached)
 * and extracts its high-res backdropUrl, posterUrl, gallery stills, and metadata snapshot for a Blog.
 */
export const resolveMovieAssetsForBlog = async (rawType, rawTmdbId) => {
  const numId = Number(rawTmdbId);
  if (!Number.isInteger(numId) || numId <= 0) return null;

  const normalizedType = rawType === 'webseries' ? 'tv' : rawType === 'tv' ? 'tv' : 'movie';
  const titleDoc = await getOrFetchTitle(normalizedType, numId, { details: true });
  if (!titleDoc) return null;

  const shaped = shapeDetail(titleDoc);
  const backdrops = (titleDoc.images?.backdrops || [])
    .map((b) => imgUrl(b.filePath, 'w1280'))
    .filter(Boolean);
  const posters = (titleDoc.images?.posters || [])
    .map((p) => imgUrl(p.filePath, 'w500'))
    .filter(Boolean);

  const coverImage = shaped.backdropUrl || backdrops[0] || shaped.posterUrl || '';
  const posterImage = shaped.posterUrl || posters[0] || '';
  const galleryImages = Array.from(new Set([coverImage, ...backdrops, ...posters].filter(Boolean))).slice(0, 10);

  return {
    titleRef: titleDoc._id,
    tmdbId: titleDoc.tmdbId,
    mediaType: titleDoc.mediaType,
    subType: titleDoc.subType || normalizedType,
    coverImage,
    posterImage,
    galleryImages,
    linkedTitleSnapshot: {
      tmdbId: titleDoc.tmdbId,
      type: titleDoc.mediaType,
      subType: titleDoc.subType || normalizedType,
      title: shaped.title,
      year: shaped.year,
      rating: shaped.rating || 0,
      posterUrl: posterImage,
      backdropUrl: coverImage,
      trailerUrl: shaped.trailerUrl || '',
      verdict: shaped.boxOffice?.verdict || 'TBA',
      genres: (shaped.genres || []).map((g) => g.name || g).filter(Boolean),
    },
  };
};

const shapeBlog = (b, currentUserId = null) => {
  const obj = typeof b.toObject === 'function' ? b.toObject() : b;
  const likesArr = Array.isArray(obj.likes) ? obj.likes : [];
  return {
    id: String(obj._id),
    title: obj.title,
    slug: obj.slug,
    subtitle: obj.subtitle || '',
    summary: obj.summary || String(obj.content || '').slice(0, 220),
    content: obj.content,
    category: obj.category || 'Editorial',
    tags: obj.tags || [],
    tmdbId: obj.tmdbId || null,
    mediaType: obj.mediaType || 'movie',
    subType: obj.subType || 'movie',
    coverImage: obj.coverImage || obj.linkedTitleSnapshot?.backdropUrl || obj.linkedTitleSnapshot?.posterUrl || '',
    posterImage: obj.posterImage || obj.linkedTitleSnapshot?.posterUrl || '',
    galleryImages: obj.galleryImages || [],
    linkedTitle: obj.linkedTitleSnapshot?.tmdbId ? obj.linkedTitleSnapshot : null,
    author: obj.author?._id
      ? {
          id: String(obj.author._id),
          name: obj.author.name || obj.authorName,
          role: obj.author.role || obj.authorRole,
          avatarColor: obj.author.avatarColor,
        }
      : {
          id: obj.author ? String(obj.author) : null,
          name: obj.authorName || 'Movies Hub Editorial',
          role: obj.authorRole || 'admin',
        },
    status: obj.status,
    isFeatured: Boolean(obj.isFeatured),
    isPinned: Boolean(obj.isPinned),
    allowComments: obj.allowComments !== false,
    readTimeMinutes: obj.readTimeMinutes || 3,
    viewsCount: obj.viewsCount || 0,
    likeCount: obj.likeCount ?? likesArr.length,
    liked: currentUserId ? likesArr.some((id) => String(id) === String(currentUserId)) : false,
    commentCount: obj.commentCount || 0,
    publishedAt: obj.publishedAt || obj.createdAt,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
};

const shapeBlogComment = (c, currentUserId = null) => ({
  id: String(c._id),
  blogId: String(c.blog),
  parent: c.parent ? String(c.parent) : null,
  body: c.body,
  spoiler: Boolean(c.spoiler),
  isPinned: Boolean(c.isPinned),
  isHidden: Boolean(c.isHidden),
  isEdited: Boolean(c.isEdited),
  likesCount: c.likes?.length || 0,
  liked: currentUserId ? (c.likes || []).some((id) => String(id) === String(currentUserId)) : false,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  user: c.user
    ? {
        id: String(c.user._id || c.user.id),
        name: c.user.name,
        avatarColor: c.user.avatarColor,
        role: c.user.role,
      }
    : null,
});

/**
 * Admin / SuperAdmin Helper: Preview & Auto-Fetch Movie Image URLs by Movie ID
 * GET /api/v1/blogs/movie-assets/:type/:tmdbId
 */
export const previewMovieAssetsForBlog = asyncHandler(async (req, res) => {
  const { type = 'movie', tmdbId } = req.params;
  const assets = await resolveMovieAssetsForBlog(type, tmdbId);
  if (!assets) {
    throw ApiError.notFound(`Could not find movie/series (${type}/${tmdbId}) in DB or TMDB`);
  }
  res.json({
    success: true,
    assets,
  });
});

/**
 * Public: List Published Blogs (with search, category, tag, tmdbId, and featured filters)
 * GET /api/v1/blogs
 */
export const listBlogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  const filter = {};

  // Staff can view drafts/archived when passing ?status=all or ?status=draft
  const isStaff = req.user && ['admin', 'superadmin'].includes(req.user.role);
  if (isStaff && req.query.status) {
    if (req.query.status !== 'all') filter.status = req.query.status;
  } else {
    filter.status = 'published';
  }

  if (req.query.category && req.query.category !== 'all') {
    filter.category = req.query.category;
  }
  if (req.query.tag) {
    filter.tags = String(req.query.tag).toLowerCase().trim();
  }
  if (req.query.tmdbId) {
    filter.tmdbId = Number(req.query.tmdbId);
  }
  if (req.query.featured === 'true') {
    filter.isFeatured = true;
  }
  if (req.query.q) {
    const safeQ = String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { title: { $regex: safeQ, $options: 'i' } },
      { subtitle: { $regex: safeQ, $options: 'i' } },
      { summary: { $regex: safeQ, $options: 'i' } },
      { 'linkedTitleSnapshot.title': { $regex: safeQ, $options: 'i' } },
      { tags: { $regex: safeQ, $options: 'i' } },
    ];
  }

  const sortKey =
    req.query.sort === 'popular'
      ? { likeCount: -1, viewsCount: -1, publishedAt: -1 }
      : { isPinned: -1, publishedAt: -1, createdAt: -1 };

  const [docs, total] = await Promise.all([
    Blog.find(filter)
      .populate('author', 'name avatarColor role')
      .sort(sortKey)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Blog.countDocuments(filter),
  ]);

  res.json({
    success: true,
    page,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    items: docs.map((d) => shapeBlog(d, req.user?._id)),
  });
});

/**
 * Public: Get Single Blog by Slug or ID (increments viewsCount & returns related movie blogs)
 * GET /api/v1/blogs/:slugOrId
 */
export const getBlog = asyncHandler(async (req, res) => {
  const { slugOrId } = req.params;
  const query = mongoose.Types.ObjectId.isValid(slugOrId)
    ? { $or: [{ _id: slugOrId }, { slug: slugOrId.toLowerCase() }] }
    : { slug: slugOrId.toLowerCase() };

  const doc = await Blog.findOneAndUpdate(
    query,
    { $inc: { viewsCount: 1 } },
    { new: true },
  ).populate('author', 'name avatarColor role');

  if (!doc) throw ApiError.notFound('Blog article not found');

  const isStaff = req.user && ['admin', 'superadmin'].includes(req.user.role);
  if (doc.status !== 'published' && !isStaff) {
    throw ApiError.notFound('Blog article not found');
  }

  // Fetch related blogs (either for the same movie or same category)
  const relatedDocs = await Blog.find({
    _id: { $ne: doc._id },
    status: 'published',
    $or: [
      ...(doc.tmdbId ? [{ tmdbId: doc.tmdbId }] : []),
      { category: doc.category },
    ],
  })
    .populate('author', 'name avatarColor role')
    .sort({ publishedAt: -1 })
    .limit(4)
    .lean();

  res.json({
    success: true,
    blog: shapeBlog(doc, req.user?._id),
    related: relatedDocs.map((r) => shapeBlog(r, req.user?._id)),
  });
});

/**
 * Admin / SuperAdmin: Create Blog (Automatically fetches movie image URLs when `tmdbId` is supplied)
 * POST /api/v1/blogs
 */
export const createBlog = asyncHandler(async (req, res) => {
  const {
    title,
    subtitle = '',
    summary = '',
    content,
    category = 'Editorial',
    tags = [],
    tmdbId,
    mediaType = 'movie',
    coverImage,
    posterImage,
    galleryImages,
    status = 'published',
    isFeatured = false,
    isPinned = false,
    allowComments = true,
  } = req.body;

  if (!title || !String(title).trim()) {
    throw ApiError.badRequest('Blog title is required');
  }
  if (!content || !String(content).trim()) {
    throw ApiError.badRequest('Blog content is required');
  }

  // If Admin/SuperAdmin selected a movie by tmdbId, automatically fetch its images & metadata
  let movieAssets = null;
  if (tmdbId) {
    movieAssets = await resolveMovieAssetsForBlog(mediaType, tmdbId);
    if (!movieAssets) {
      throw ApiError.badRequest(`No movie/series found for ${mediaType}/${tmdbId}`);
    }
  }

  const parsedTags = Array.isArray(tags)
    ? tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
    : String(tags || '')
        .split(',')
        .map((t) => t.toLowerCase().trim())
        .filter(Boolean);

  const blog = await Blog.create({
    title: String(title).trim(),
    slug: makeSlug(title),
    subtitle: String(subtitle || '').trim(),
    summary: String(summary || '').trim() || String(content).trim().slice(0, 240),
    content: String(content),
    category,
    tags: parsedTags,
    tmdbId: movieAssets?.tmdbId || (tmdbId ? Number(tmdbId) : null),
    mediaType: movieAssets?.mediaType || (mediaType === 'webseries' ? 'tv' : mediaType),
    subType: movieAssets?.subType || mediaType,
    titleRef: movieAssets?.titleRef || null,
    // Use Admin's custom image if explicitly provided; otherwise auto-use the movie's TMDB backdrop/poster!
    coverImage: coverImage || movieAssets?.coverImage || '',
    posterImage: posterImage || movieAssets?.posterImage || '',
    galleryImages: Array.isArray(galleryImages) && galleryImages.length
      ? galleryImages
      : movieAssets?.galleryImages || [],
    linkedTitleSnapshot: movieAssets?.linkedTitleSnapshot || {},
    author: req.user._id,
    authorName: req.user.name,
    authorRole: req.user.role,
    status,
    isFeatured: Boolean(isFeatured),
    isPinned: Boolean(isPinned),
    allowComments: allowComments !== false,
    readTimeMinutes: estimateReadTime(content),
    publishedAt: status === 'published' ? new Date() : null,
  });

  await blog.populate('author', 'name avatarColor role');
  res.status(201).json({
    success: true,
    message: 'Blog article created',
    blog: shapeBlog(blog, req.user._id),
  });
});

/**
 * Admin / SuperAdmin: Update Blog (Re-resolves movie images if `tmdbId` changes)
 * PATCH /api/v1/blogs/:id
 */
export const updateBlog = asyncHandler(async (req, res) => {
  const blog = await Blog.findById(req.params.id);
  if (!blog) throw ApiError.notFound('Blog article not found');

  const {
    title,
    subtitle,
    summary,
    content,
    category,
    tags,
    tmdbId,
    mediaType,
    coverImage,
    posterImage,
    galleryImages,
    status,
    isFeatured,
    isPinned,
    allowComments,
    refreshMovieImages,
  } = req.body;

  if (title !== undefined) blog.title = String(title).trim();
  if (subtitle !== undefined) blog.subtitle = String(subtitle).trim();
  if (summary !== undefined) blog.summary = String(summary).trim();
  if (content !== undefined) {
    blog.content = String(content);
    blog.readTimeMinutes = estimateReadTime(content);
  }
  if (category !== undefined) blog.category = category;
  if (tags !== undefined) {
    blog.tags = Array.isArray(tags)
      ? tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean)
      : String(tags)
          .split(',')
          .map((t) => t.toLowerCase().trim())
          .filter(Boolean);
  }

  // If tmdbId was updated or refreshMovieImages was requested, re-fetch movie images automatically
  const targetTmdbId = tmdbId !== undefined ? Number(tmdbId) : blog.tmdbId;
  const targetType = mediaType || blog.subType || blog.mediaType || 'movie';
  if ((tmdbId !== undefined && Number(tmdbId) !== blog.tmdbId) || refreshMovieImages) {
    if (targetTmdbId) {
      const assets = await resolveMovieAssetsForBlog(targetType, targetTmdbId);
      if (assets) {
        blog.tmdbId = assets.tmdbId;
        blog.mediaType = assets.mediaType;
        blog.subType = assets.subType;
        blog.titleRef = assets.titleRef;
        blog.coverImage = coverImage || assets.coverImage;
        blog.posterImage = posterImage || assets.posterImage;
        blog.galleryImages = assets.galleryImages;
        blog.linkedTitleSnapshot = assets.linkedTitleSnapshot;
      }
    } else {
      blog.tmdbId = null;
      blog.titleRef = null;
      blog.linkedTitleSnapshot = {};
    }
  }

  if (coverImage !== undefined) blog.coverImage = String(coverImage).trim();
  if (posterImage !== undefined) blog.posterImage = String(posterImage).trim();
  if (Array.isArray(galleryImages)) blog.galleryImages = galleryImages;
  if (status !== undefined) {
    if (status === 'published' && blog.status !== 'published' && !blog.publishedAt) {
      blog.publishedAt = new Date();
    }
    blog.status = status;
  }
  if (isFeatured !== undefined) blog.isFeatured = Boolean(isFeatured);
  if (isPinned !== undefined) blog.isPinned = Boolean(isPinned);
  if (allowComments !== undefined) blog.allowComments = Boolean(allowComments);

  await blog.save();
  await blog.populate('author', 'name avatarColor role');

  res.json({
    success: true,
    message: 'Blog article updated',
    blog: shapeBlog(blog, req.user._id),
  });
});

/**
 * Admin / SuperAdmin: Delete Blog & its comments
 * DELETE /api/v1/blogs/:id
 */
export const deleteBlog = asyncHandler(async (req, res) => {
  const blog = await Blog.findByIdAndDelete(req.params.id);
  if (!blog) throw ApiError.notFound('Blog article not found');
  await BlogComment.deleteMany({ blog: blog._id });
  res.json({
    success: true,
    message: 'Blog article and its comments deleted',
  });
});

/**
 * Protected User: Toggle Like on a Blog Article
 * POST /api/v1/blogs/:id/like
 */
export const toggleBlogLike = asyncHandler(async (req, res) => {
  const blog = await Blog.findById(req.params.id);
  if (!blog) throw ApiError.notFound('Blog article not found');

  const uid = String(req.user._id);
  const idx = blog.likes.findIndex((id) => String(id) === uid);
  const liked = idx === -1;

  if (liked) blog.likes.push(req.user._id);
  else blog.likes.splice(idx, 1);

  blog.likeCount = blog.likes.length;
  await blog.save();

  res.json({
    success: true,
    liked,
    likeCount: blog.likeCount,
  });
});

/**
 * Public (with optionalAuth): List Threaded Comments on a Blog Article
 * GET /api/v1/blogs/:id/comments
 */
export const listBlogComments = asyncHandler(async (req, res) => {
  const blog = await Blog.findById(req.params.id).select('_id').lean();
  if (!blog) throw ApiError.notFound('Blog article not found');

  const docs = await BlogComment.find({ blog: blog._id, isHidden: { $ne: true } })
    .populate('user', 'name avatarColor role')
    .sort({ isPinned: -1, createdAt: -1 })
    .limit(300);

  res.json({
    success: true,
    total: docs.length,
    comments: docs.map((c) => shapeBlogComment(c, req.user?._id)),
  });
});

/**
 * Protected User: Add a Comment or Reply on a Blog Article
 * POST /api/v1/blogs/:id/comments
 */
export const addBlogComment = asyncHandler(async (req, res) => {
  const { body, parent = null, spoiler = false } = req.body;
  if (!body || !String(body).trim()) {
    throw ApiError.badRequest('Comment body is required');
  }

  const blog = await Blog.findById(req.params.id);
  if (!blog) throw ApiError.notFound('Blog article not found');
  if (blog.allowComments === false) {
    throw ApiError.forbidden('Comments are disabled for this article');
  }

  if (parent) {
    const parentComment = await BlogComment.findOne({ _id: parent, blog: blog._id });
    if (!parentComment) throw ApiError.notFound('Parent comment not found');
  }

  const comment = await BlogComment.create({
    blog: blog._id,
    user: req.user._id,
    parent: parent || null,
    body: String(body).trim().slice(0, 2000),
    spoiler: Boolean(spoiler),
  });

  // Recalculate visible commentCount on Blog
  blog.commentCount = await BlogComment.countDocuments({ blog: blog._id, isHidden: { $ne: true } });
  await blog.save();

  await comment.populate('user', 'name avatarColor role');
  res.status(201).json({
    success: true,
    comment: shapeBlogComment(comment, req.user._id),
    commentCount: blog.commentCount,
  });
});

/**
 * Protected User: Toggle Like on a Blog Comment
 * POST /api/v1/blogs/comments/:commentId/like
 */
export const toggleBlogCommentLike = asyncHandler(async (req, res) => {
  const comment = await BlogComment.findById(req.params.commentId);
  if (!comment) throw ApiError.notFound('Comment not found');

  const uid = String(req.user._id);
  const idx = comment.likes.findIndex((id) => String(id) === uid);
  const liked = idx === -1;

  if (liked) comment.likes.push(req.user._id);
  else comment.likes.splice(idx, 1);

  await comment.save();
  res.json({
    success: true,
    liked,
    likesCount: comment.likes.length,
  });
});

/**
 * Protected User (Owner) or Admin/SuperAdmin: Delete a Blog Comment
 * DELETE /api/v1/blogs/comments/:commentId
 */
export const deleteBlogComment = asyncHandler(async (req, res) => {
  const comment = await BlogComment.findById(req.params.commentId);
  if (!comment) throw ApiError.notFound('Comment not found');

  const isOwner = String(comment.user) === String(req.user._id);
  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  if (!isOwner && !isStaff) {
    throw ApiError.forbidden('You cannot delete this comment');
  }

  const blogId = comment.blog;
  await BlogComment.deleteMany({ $or: [{ _id: comment._id }, { parent: comment._id }] });

  const remaining = await BlogComment.countDocuments({ blog: blogId, isHidden: { $ne: true } });
  await Blog.findByIdAndUpdate(blogId, { $set: { commentCount: remaining } });

  res.json({
    success: true,
    message: 'Comment deleted',
    commentCount: remaining,
  });
});

/**
 * Admin / SuperAdmin: Moderate a Blog Comment (Pin / Hide / Spoiler)
 * PATCH /api/v1/blogs/comments/:commentId
 */
export const moderateBlogComment = asyncHandler(async (req, res) => {
  const comment = await BlogComment.findById(req.params.commentId);
  if (!comment) throw ApiError.notFound('Comment not found');

  if (typeof req.body.isHidden === 'boolean') comment.isHidden = req.body.isHidden;
  if (typeof req.body.isPinned === 'boolean') comment.isPinned = req.body.isPinned;
  if (typeof req.body.spoiler === 'boolean') comment.spoiler = req.body.spoiler;

  await comment.save();
  const remaining = await BlogComment.countDocuments({ blog: comment.blog, isHidden: { $ne: true } });
  await Blog.findByIdAndUpdate(comment.blog, { $set: { commentCount: remaining } });

  await comment.populate('user', 'name avatarColor role');
  res.json({
    success: true,
    comment: shapeBlogComment(comment, req.user._id),
  });
});
