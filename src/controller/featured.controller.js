import Featured from '../models/Featured.js';
import Title from '../models/Title.js';
import CrawlJob from '../models/CrawlJob.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getOrFetchTitle, shapeTitle } from '../services/title.service.js';
import { normalizeMediaType } from '../utils/title.js';

const HERO_CONFIG_JOB_NAME = 'hero_carousel_config';
let inMemoryHeroLimit = 10;

export const getHeroSlideLimit = async () => {
  try {
    const doc = await CrawlJob.findOne({ name: HERO_CONFIG_JOB_NAME }).lean();
    const saved = Number(doc?.targetTotal);
    if (Number.isInteger(saved) && saved >= 1 && saved <= 200) {
      inMemoryHeroLimit = saved;
      return saved;
    }
  } catch {
    /* ignore */
  }
  return inMemoryHeroLimit || 10;
};

export const setHeroSlideLimit = async (newLimit) => {
  const parsed = Number(newLimit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw ApiError.badRequest('Hero carousel slide count must be between 1 and 200');
  }
  inMemoryHeroLimit = parsed;
  try {
    await CrawlJob.findOneAndUpdate(
      { name: HERO_CONFIG_JOB_NAME },
      { $set: { targetTotal: parsed, lastStep: `heroLimit=${parsed}` } },
      { upsert: true, new: true },
    );
  } catch {
    /* ignore */
  }
  return parsed;
};

/**
 * Helper: Hydrates Featured documents with their full Title card data
 * and applies any custom Admin/SuperAdmin hero overrides (title, tagline, overview, backdrop, poster, badge).
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
      isFeaturedSlide: true,
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
 * Queries ALL active, non-expired Featured items in Admin/SuperAdmin's exact display order (no artificial 10/20 cap!).
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
    .lean();

  return hydrateFeaturedItems(docs);
};

// Public: GET /api/v1/featured
export const listPublicFeatured = asyncHandler(async (_req, res) => {
  const [items, heroLimit] = await Promise.all([
    getActiveFeaturedHero(),
    getHeroSlideLimit(),
  ]);
  res.json({
    success: true,
    total: items.length,
    heroLimit,
    items,
  });
});

// Admin & SuperAdmin: GET /api/v1/featured/admin (or /api/v1/superadmin/featured)
export const listAdminFeatured = asyncHandler(async (_req, res) => {
  const [docs, heroLimit] = await Promise.all([
    Featured.find().sort({ order: 1, createdAt: -1 }).lean(),
    getHeroSlideLimit(),
  ]);
  const items = await hydrateFeaturedItems(docs);
  res.json({
    success: true,
    total: items.length,
    heroLimit,
    items,
  });
});

// Admin & SuperAdmin: PATCH /api/v1/featured/config
export const updateHeroConfig = asyncHandler(async (req, res) => {
  const rawLimit = req.body.heroLimit ?? req.body.maxSlides ?? req.body.limit;
  const heroLimit = await setHeroSlideLimit(rawLimit);
  res.json({
    success: true,
    message: `Home Hero Carousel slide count updated to ${heroLimit}`,
    heroLimit,
  });
});

// Admin & SuperAdmin: POST /api/v1/featured
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

  const normalizedType = normalizeMediaType(type);
  if (!['movie', 'tv'].includes(normalizedType)) {
    throw ApiError.badRequest("type must be 'movie', 'tv', or 'webseries'");
  }

  const isWeb = type === 'webseries' || type === 'web-series';

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
        subType: titleDoc.subType || (isWeb ? 'webseries' : normalizedType),
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

  // If Admin adds more active slides than current heroLimit, automatically expand heroLimit so all added slides can show
  const activeCount = await Featured.countDocuments({ isActive: true });
  const currentLimit = await getHeroSlideLimit();
  const nextHeroLimit = activeCount > currentLimit ? await setHeroSlideLimit(activeCount) : currentLimit;

  const [hydrated] = await hydrateFeaturedItems([featuredDoc]);
  res.status(201).json({
    success: true,
    message: 'Title added to Home Featured Hero Carousel',
    heroLimit: nextHeroLimit,
    item: hydrated,
  });
});

// Admin & SuperAdmin: PATCH /api/v1/featured/:id
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
    'notes',
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

// Admin & SuperAdmin: PUT /api/v1/featured/reorder
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

// Admin & SuperAdmin: DELETE /api/v1/featured/:id
export const removeFeaturedItem = asyncHandler(async (req, res) => {
  const doc = await Featured.findByIdAndDelete(req.params.id);
  if (!doc) throw ApiError.notFound('Featured item not found');
  res.json({
    success: true,
    message: 'Removed from Featured Hero Carousel',
  });
});
