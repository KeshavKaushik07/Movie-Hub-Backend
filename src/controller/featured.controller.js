import Featured from '../models/Featured.js';
import Title from '../models/Title.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getOrFetchTitle, shapeTitle } from '../services/title.service.js';

/**
 * Helper: Hydrates Featured documents with their full Title card data
 * and applies any custom SuperAdmin hero overrides (title, tagline, overview, backdrop, poster, badge).
 */
export const hydrateFeaturedItems = async (featuredDocs) => {
  if (!featuredDocs.length) return [];

  const orConditions = featuredDocs.map((f) => ({
    mediaType: f.type,
    tmdbId: f.tmdbId,
  }));

  const titles = await Title.find({ $or: orConditions }).lean();
  const titleMap = new Map(titles.map((t) => [`${t.mediaType}:${t.tmdbId}`, t]));

  const hydrated = [];
  for (const f of featuredDocs) {
    let titleDoc = titleMap.get(`${f.type}:${f.tmdbId}`);
    if (!titleDoc) {
      // Lazy fetch from TMDB if not yet in Title DB
      titleDoc = await getOrFetchTitle(f.type, f.tmdbId, { details: true }).catch(() => null);
    }
    if (!titleDoc) continue;

    const card = shapeTitle(titleDoc);
    hydrated.push({
      ...card,
      featuredId: String(f._id),
      order: f.order,
      isActive: f.isActive,
      badgeText: f.badgeText || 'Featured on Movies Hub',
      title: f.customTitle || card.title,
      name: f.customTitle || card.name,
      tagline: f.customTagline || titleDoc.tagline || '',
      overview: f.customOverview || card.overview,
      backdropUrl: f.customBackdropUrl || card.backdropUrl || card.posterUrl,
      posterUrl: f.customPosterUrl || card.posterUrl,
      trailerKey: f.customTrailerKey || card.trailerKey || titleDoc.trailerKey || null,
      trailerUrl:
        f.customTrailerKey
          ? `https://www.youtube.com/watch?v=${f.customTrailerKey}`
          : card.trailerUrl,
      customTitle: f.customTitle || '',
      customTagline: f.customTagline || '',
      customOverview: f.customOverview || '',
      customBackdropUrl: f.customBackdropUrl || '',
      customPosterUrl: f.customPosterUrl || '',
      customTrailerKey: f.customTrailerKey || '',
      startAt: f.startAt,
      expiresAt: f.expiresAt,
      notes: f.notes || '',
      createdAt: f.createdAt,
    });
  }

  return hydrated;
};

/**
 * Queries active, non-expired Featured items in SuperAdmin's exact display order.
 */
export const getActiveFeaturedHero = async () => {
  const now = new Date();
  const docs = await Featured.find({
    isActive: true,
    $and: [
      { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
    ],
  })
    .sort({ order: 1, createdAt: -1 })
    .limit(20)
    .lean();

  return hydrateFeaturedItems(docs);
};

// Public: GET /api/v1/featured
export const listPublicFeatured = asyncHandler(async (_req, res) => {
  const items = await getActiveFeaturedHero();
  res.json({
    success: true,
    total: items.length,
    items,
  });
});

// SuperAdmin: GET /api/v1/featured/admin (or /api/v1/superadmin/featured)
export const listAdminFeatured = asyncHandler(async (_req, res) => {
  const docs = await Featured.find().sort({ order: 1, createdAt: -1 }).lean();
  const items = await hydrateFeaturedItems(docs);
  res.json({
    success: true,
    total: items.length,
    items,
  });
});

// SuperAdmin: POST /api/v1/featured
export const addFeaturedItem = asyncHandler(async (req, res) => {
  const {
    tmdbId,
    type = 'movie',
    order,
    isActive = true,
    badgeText,
    customTitle,
    customTagline,
    customOverview,
    customBackdropUrl,
    customPosterUrl,
    customTrailerKey,
    startAt,
    expiresAt,
    notes,
  } = req.body;

  const numId = Number(tmdbId);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw ApiError.badRequest('Valid numeric tmdbId is required');
  }

  const normalizedType = type === 'webseries' ? 'tv' : type;
  if (!['movie', 'tv'].includes(normalizedType)) {
    throw ApiError.badRequest("type must be 'movie', 'tv', or 'webseries'");
  }

  // Ensure the movie/series exists in MongoDB (or fetch it from TMDB automatically)
  const titleDoc = await getOrFetchTitle(normalizedType, numId, { details: true });
  if (!titleDoc) {
    throw ApiError.notFound(`Title ${normalizedType}/${numId} not found in database or TMDB`);
  }

  // Determine next order index if not explicitly provided
  let resolvedOrder = Number(order);
  if (!Number.isFinite(resolvedOrder)) {
    const highest = await Featured.findOne().sort({ order: -1 }).select('order').lean();
    resolvedOrder = (highest?.order || 0) + 1;
  }

  const featuredDoc = await Featured.findOneAndUpdate(
    { type: normalizedType, tmdbId: numId },
    {
      $set: {
        tmdbId: numId,
        type: normalizedType,
        subType: titleDoc.subType || (type === 'webseries' ? 'webseries' : normalizedType),
        titleRef: titleDoc._id,
        order: resolvedOrder,
        isActive: Boolean(isActive),
        ...(badgeText !== undefined ? { badgeText: String(badgeText).trim() } : {}),
        ...(customTitle !== undefined ? { customTitle: String(customTitle).trim() } : {}),
        ...(customTagline !== undefined ? { customTagline: String(customTagline).trim() } : {}),
        ...(customOverview !== undefined ? { customOverview: String(customOverview).trim() } : {}),
        ...(customBackdropUrl !== undefined ? { customBackdropUrl: String(customBackdropUrl).trim() } : {}),
        ...(customPosterUrl !== undefined ? { customPosterUrl: String(customPosterUrl).trim() } : {}),
        ...(customTrailerKey !== undefined ? { customTrailerKey: String(customTrailerKey).trim() } : {}),
        ...(startAt !== undefined ? { startAt: startAt ? new Date(startAt) : null } : {}),
        ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
        ...(notes !== undefined ? { notes: String(notes).trim() } : {}),
        addedBy: req.user._id,
      },
    },
    { upsert: true, new: true, runValidators: true },
  ).lean();

  const [hydrated] = await hydrateFeaturedItems([featuredDoc]);
  res.status(201).json({
    success: true,
    message: 'Title added to Home Featured Hero Carousel',
    item: hydrated,
  });
});

// SuperAdmin: PATCH /api/v1/featured/:id
export const updateFeaturedItem = asyncHandler(async (req, res) => {
  const doc = await Featured.findById(req.params.id);
  if (!doc) throw ApiError.notFound('Featured item not found');

  const allowed = [
    'order',
    'isActive',
    'badgeText',
    'customTitle',
    'customTagline',
    'customOverview',
    'customBackdropUrl',
    'customPosterUrl',
    'customTrailerKey',
    ' notes',
  ];

  for (const key of allowed) {
    const cleanKey = key.trim();
    if (req.body[cleanKey] !== undefined) {
      doc[cleanKey] = req.body[cleanKey];
    }
  }
  if (req.body.startAt !== undefined) doc.startAt = req.body.startAt ? new Date(req.body.startAt) : null;
  if (req.body.expiresAt !== undefined) doc.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;

  await doc.save();
  const [hydrated] = await hydrateFeaturedItems([doc.toObject()]);
  res.json({
    success: true,
    message: 'Featured Hero Carousel item updated',
    item: hydrated,
  });
});

// SuperAdmin: PUT /api/v1/featured/reorder
export const reorderFeaturedItems = asyncHandler(async (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds) || !orderedIds.length) {
    throw ApiError.badRequest('orderedIds array is required');
  }

  const ops = orderedIds.map((id, idx) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { order: idx + 1 } },
    },
  }));
  await Featured.bulkWrite(ops);

  const docs = await Featured.find().sort({ order: 1, createdAt: -1 }).lean();
  const items = await hydrateFeaturedItems(docs);
  res.json({
    success: true,
    message: 'Featured Hero Carousel order updated',
    items,
  });
});

// SuperAdmin: DELETE /api/v1/featured/:id
export const removeFeaturedItem = asyncHandler(async (req, res) => {
  const doc = await Featured.findByIdAndDelete(req.params.id);
  if (!doc) throw ApiError.notFound('Featured item not found');
  res.json({
    success: true,
    message: 'Removed from Featured Hero Carousel',
  });
});
