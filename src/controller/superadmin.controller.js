import ApiKey from '../models/ApiKey.js';
import Title from '../models/Title.js';
import User from '../models/User.js';
import Review from '../models/Review.js';
import Comment from '../models/Comment.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sha256 } from '../utils/crypto.js';
import { assertStrongPassword } from '../utils/password.js';
import { ROLES } from '../config/constant.js';
import {
  checkKey,
  createKeyRecord,
  currentKeyId,
  refreshKeyCache,
} from '../services/apiKey.service.js';
import {
  getCrawlerStatus,
  getQuotas,
  requestStop,
  setTargetCap,
  startCrawl,
} from '../services/crawler.service.js';
import {
  computeVerdict,
  getOrFetchTitle,
  shapeDetail,
  shapeTitle,
} from '../services/title.service.js';

const TMDB_KEY = /^[a-f0-9]{32}$/i;
const toPriority = (v) =>
  Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 1000
    ? Number(v)
    : undefined;

// ===================== SuperAdmin: Create Admin / User =====================
export const createStaffOrUser = asyncHandler(async (req, res) => {
  const { name, email, password, role = ROLES.ADMIN } = req.body;
  if (!name?.trim() || !email?.trim())
    throw ApiError.badRequest('Name and email are required');
  if (![ROLES.USER, ROLES.ADMIN, ROLES.SUPERADMIN].includes(role))
    throw ApiError.badRequest('Role must be "user", "admin", or "superadmin"');
  if (role === ROLES.SUPERADMIN && req.user.role !== ROLES.SUPERADMIN) {
    throw ApiError.forbidden('Only a Super Admin can create another Super Admin account');
  }
  assertStrongPassword(password);
  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
    role,
    isActive: true,
  });
  res.status(201).json({ user });
});

// ===================== SuperAdmin: Full Movie / TV / Web Series Database CRUD =====================
export const listDatabaseTitles = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const skip = (page - 1) * limit;

  const filter = {};
  const andConditions = [];

  const rawType = String(req.query.type || '')
    .toLowerCase()
    .trim();
  const rawSubType = String(req.query.subType || '')
    .toLowerCase()
    .trim();

  if (rawType === 'movie' || rawSubType === 'movie') {
    filter.mediaType = 'movie';
  } else if (rawType === 'webseries' || rawSubType === 'webseries') {
    filter.mediaType = 'tv';
    andConditions.push({
      $or: [{ subType: 'webseries' }, { isWebSeries: true }],
    });
  } else if (rawType === 'tv' || rawSubType === 'tv') {
    filter.mediaType = 'tv';
    andConditions.push({
      subType: { $ne: 'webseries' },
      isWebSeries: { $ne: true },
    });
  }

  if (req.query.industry)
    filter.regions = String(req.query.industry).toLowerCase();
  if (req.query.ott) filter.ottProviders = String(req.query.ott).toLowerCase();
  if (req.query.trendingOnly === 'true') filter.listTags = 'trending';
  if (req.query.customOnly === 'true') filter.isCustom = true;
  if (req.query.editedOnly === 'true')
    filter['lockedFields.0'] = { $exists: true };

  if (req.query.q) {
    const q = String(req.query.q).trim();
    if (/^\d+$/.test(q)) {
      filter.tmdbId = Number(q);
    } else {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andConditions.push({
        $or: [
          { title: { $regex: escaped, $options: 'i' } },
          { originalTitle: { $regex: escaped, $options: 'i' } },
        ],
      });
    }
  }

  const sortParam = String(req.query.sort || 'updated')
    .toLowerCase()
    .trim();
  let sortQuery = { updatedAt: -1, popularity: -1 };

  switch (sortParam) {
    case 'popularity':
    case 'popular':
      sortQuery = { popularity: -1, voteCount: -1 };
      break;
    case 'trending':
      sortQuery = { isCustom: -1, popularity: -1, updatedAt: -1 };
      break;
    case 'newest':
      sortQuery = { year: -1, releaseDate: -1, popularity: -1 };
      break;
    case 'oldest':
      andConditions.push({ year: { $gt: 1880 } });
      sortQuery = { year: 1, releaseDate: 1, popularity: -1 };
      break;
    case 'rating':
      sortQuery = { voteAverage: -1, voteCount: -1, popularity: -1 };
      break;
    case 'revenue':
    case 'boxoffice':
      sortQuery = {
        revenue: -1,
        'boxOffice.worldwideCollection': -1,
        popularity: -1,
      };
      break;
    case 'budget':
      sortQuery = { budget: -1, popularity: -1 };
      break;
    case 'title':
    case 'title_asc':
      sortQuery = { title: 1 };
      break;
    case 'title_desc':
      sortQuery = { title: -1 };
      break;
    case 'updated':
    default:
      sortQuery = { updatedAt: -1, popularity: -1 };
      break;
  }

  if (andConditions.length > 0) {
    filter.$and = andConditions;
  }

  const hasFilter = Object.keys(filter).length > 0 || andConditions.length > 0;
  const [docs, total] = await Promise.all([
    Title.find(filter).sort(sortQuery).skip(skip).limit(limit).lean(),
    hasFilter ? Title.countDocuments(filter) : Title.estimatedDocumentCount(),
  ]);

  res.json({
    items: docs.map((d) => ({
      ...shapeTitle(d),
      listTags: d.listTags || [],
      isTrending: (d.listTags || []).includes('trending'),
      detailsFetched: !!d.detailsFetched,
      lockedFields: d.lockedFields || [],
      songsCount: (d.songs || []).length,
      videosCount: (d.videos || []).length,
      boxOffice: d.boxOffice || {},
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

export const createCustomTitle = asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.title || typeof b.title !== 'string')
    throw ApiError.badRequest('Title name is required');
  const rawType = String(b.mediaType || b.type || 'movie').toLowerCase();
  const mediaType =
    rawType === 'webseries'
      ? 'tv'
      : ['movie', 'tv'].includes(rawType)
        ? rawType
        : 'movie';
  const subType =
    rawType === 'webseries' || b.isWebSeries ? 'webseries' : mediaType;
  const tmdbId =
    Number(b.tmdbId) || Math.floor(900_000_000 + Math.random() * 99_000_000);

  if (await Title.exists({ mediaType, tmdbId })) {
    throw ApiError.conflict(
      `A ${mediaType} with ID ${tmdbId} already exists in the database`,
    );
  }

  const budget = Number(b.budget) || 0;
  const revenue = Number(b.revenue ?? b.boxOffice?.worldwideCollection) || 0;
  const releaseDate = b.releaseDate ? new Date(b.releaseDate) : new Date();
  const listTags = Array.isArray(b.listTags)
    ? b.listTags
    : b.isTrending
      ? ['trending', 'popular']
      : ['popular'];

  const doc = await Title.create({
    tmdbId,
    mediaType,
    subType,
    isWebSeries: subType === 'webseries',
    isCustom: true,
    detailsFetched: true,
    detailsFetchedAt: new Date(),
    title: b.title.trim(),
    originalTitle: b.originalTitle?.trim() || b.title.trim(),
    tagline: b.tagline?.trim() || '',
    overview: b.overview?.trim() || '',
    customPosterUrl: b.posterUrl || b.customPosterUrl || '',
    customBackdropUrl: b.backdropUrl || b.customBackdropUrl || '',
    releaseDate,
    year: Number(b.year) || releaseDate.getUTCFullYear(),
    runtime: Number(b.runtime) || 120,
    status: b.status || 'Released',
    certification: b.certification || 'UA',
    originalLanguage: b.originalLanguage || 'en',
    voteAverage: Number(b.voteAverage) || 8.0,
    voteCount: Number(b.voteCount) || 1,
    popularity:
      Number(b.popularity) || (listTags.includes('trending') ? 500 : 100),
    genres: Array.isArray(b.genres) ? b.genres : [{ id: 18, name: 'Drama' }],
    genreIds: Array.isArray(b.genres)
      ? b.genres.map((g) => g.id).filter(Boolean)
      : [18],
    regions: Array.isArray(b.regions) ? b.regions : ['hollywood'],
    ottProviders: Array.isArray(b.ottProviders) ? b.ottProviders : [],
    listTags,
    budget,
    revenue,
    boxOffice: {
      budgetFormatted:
        b.boxOffice?.budgetFormatted ||
        (budget > 0 ? `$${budget.toLocaleString()}` : ''),
      domesticCollection: Number(b.boxOffice?.domesticCollection) || 0,
      internationalCollection:
        Number(b.boxOffice?.internationalCollection) || 0,
      worldwideCollection: revenue,
      indiaNetCollection: Number(b.boxOffice?.indiaNetCollection) || 0,
      indiaGrossCollection: Number(b.boxOffice?.indiaGrossCollection) || 0,
      openingWeekend: Number(b.boxOffice?.openingWeekend) || 0,
      openingDay: Number(b.boxOffice?.openingDay) || 0,
      currency: b.boxOffice?.currency || 'USD',
      verdict: computeVerdict(budget, revenue, b.boxOffice?.verdict),
      notes: b.boxOffice?.notes || '',
    },
    trailerKey: b.trailerKey || '',
    songs: Array.isArray(b.songs) ? b.songs : [],
    videos: Array.isArray(b.videos)
      ? b.videos
      : b.trailerKey
        ? [
            {
              id: 'custom-trailer',
              key: b.trailerKey,
              name: 'Official Trailer',
              site: 'YouTube',
              type: 'Trailer',
              official: true,
            },
          ]
        : [],
    directors: Array.isArray(b.directors) ? b.directors : [],
    musicDirectors: Array.isArray(b.musicDirectors) ? b.musicDirectors : [],
    cast: Array.isArray(b.cast) ? b.cast : [],
    numberOfSeasons:
      Number(b.numberOfSeasons) || (mediaType === 'tv' ? 1 : undefined),
    numberOfEpisodes:
      Number(b.numberOfEpisodes) || (mediaType === 'tv' ? 8 : undefined),
    lockedFields: [
      'title',
      'overview',
      'budget',
      'revenue',
      'boxOffice',
      'songs',
      'trailerKey',
      'listTags',
    ],
    lastEditedBy: req.user._id,
    lastEditedAt: new Date(),
  });

  res.status(201).json({ title: shapeDetail(doc) });
});

export const updateTitleDetails = asyncHandler(async (req, res) => {
  const rawType = String(req.params.type || '').toLowerCase();
  const mediaType = rawType === 'webseries' ? 'tv' : rawType;
  const tmdbId = Number(req.params.tmdbId);
  if (!['movie', 'tv'].includes(mediaType) || !Number.isInteger(tmdbId)) {
    throw ApiError.badRequest('Invalid title type or ID');
  }

  let doc = await Title.findOne({ mediaType, tmdbId });
  if (!doc) {
    doc = await getOrFetchTitle(mediaType, tmdbId, { details: true });
  }
  const b = req.body;
  const locked = new Set(doc.lockedFields || []);
  const updates = {};

  const setField = (key, val) => {
    updates[key] = val;
    locked.add(key);
  };

  if (typeof b.title === 'string' && b.title.trim())
    setField('title', b.title.trim());
  if (typeof b.originalTitle === 'string')
    setField('originalTitle', b.originalTitle.trim());
  if (typeof b.tagline === 'string') setField('tagline', b.tagline.trim());
  if (typeof b.overview === 'string') setField('overview', b.overview.trim());
  if (typeof b.status === 'string') setField('status', b.status.trim());
  if (typeof b.certification === 'string')
    setField('certification', b.certification.trim());
  if (typeof b.originalLanguage === 'string')
    setField('originalLanguage', b.originalLanguage.trim());
  if (typeof b.customPosterUrl === 'string')
    setField('customPosterUrl', b.customPosterUrl.trim());
  if (typeof b.customBackdropUrl === 'string')
    setField('customBackdropUrl', b.customBackdropUrl.trim());
  if (typeof b.homepage === 'string') setField('homepage', b.homepage.trim());

  if (b.subType && ['movie', 'tv', 'webseries'].includes(b.subType)) {
    setField('subType', b.subType);
    setField('isWebSeries', b.subType === 'webseries');
  } else if (typeof b.isWebSeries === 'boolean') {
    setField('isWebSeries', b.isWebSeries);
    setField('subType', b.isWebSeries ? 'webseries' : mediaType);
  }

  // SuperAdmin manual Trending / List Tags override (`listTags` or `isTrending` boolean)
  if (Array.isArray(b.listTags)) {
    setField(
      'listTags',
      b.listTags.map((x) => String(x).toLowerCase().trim()).filter(Boolean),
    );
  } else if (typeof b.isTrending === 'boolean') {
    const currentTags = new Set(doc.listTags || []);
    if (b.isTrending) {
      currentTags.add('trending');
      if ((doc.popularity || 0) < 250) updates.popularity = 350;
    } else {
      currentTags.delete('trending');
    }
    setField('listTags', Array.from(currentTags));
  }

  if (b.year !== undefined && Number.isFinite(Number(b.year)))
    setField('year', Number(b.year));
  if (b.runtime !== undefined && Number.isFinite(Number(b.runtime)))
    setField('runtime', Number(b.runtime));
  if (b.voteAverage !== undefined && Number.isFinite(Number(b.voteAverage)))
    setField('voteAverage', Number(b.voteAverage));
  if (b.popularity !== undefined && Number.isFinite(Number(b.popularity)))
    setField('popularity', Number(b.popularity));
  if (b.numberOfSeasons !== undefined)
    setField('numberOfSeasons', Number(b.numberOfSeasons));
  if (b.numberOfEpisodes !== undefined)
    setField('numberOfEpisodes', Number(b.numberOfEpisodes));

  const currentBox = doc.boxOffice
    ? doc.boxOffice.toObject?.() || doc.boxOffice
    : {};
  const nextBudget =
    b.budget !== undefined ? Number(b.budget) : doc.budget || 0;
  const nextWorldwide =
    b.boxOffice?.worldwideCollection !== undefined
      ? Number(b.boxOffice.worldwideCollection)
      : b.revenue !== undefined
        ? Number(b.revenue)
        : currentBox.worldwideCollection || doc.revenue || 0;

  if (b.budget !== undefined) setField('budget', nextBudget);
  if (b.revenue !== undefined || b.boxOffice?.worldwideCollection !== undefined)
    setField('revenue', nextWorldwide);

  if (b.budget !== undefined || b.revenue !== undefined || b.boxOffice) {
    const bo = b.boxOffice || {};
    const updatedBoxOffice = {
      budgetFormatted:
        bo.budgetFormatted !== undefined
          ? String(bo.budgetFormatted)
          : nextBudget > 0
            ? `$${nextBudget.toLocaleString()}`
            : currentBox.budgetFormatted || '',
      domesticCollection:
        bo.domesticCollection !== undefined
          ? Number(bo.domesticCollection)
          : currentBox.domesticCollection || 0,
      internationalCollection:
        bo.internationalCollection !== undefined
          ? Number(bo.internationalCollection)
          : currentBox.internationalCollection || 0,
      worldwideCollection: nextWorldwide,
      indiaNetCollection:
        bo.indiaNetCollection !== undefined
          ? Number(bo.indiaNetCollection)
          : currentBox.indiaNetCollection || 0,
      indiaGrossCollection:
        bo.indiaGrossCollection !== undefined
          ? Number(bo.indiaGrossCollection)
          : currentBox.indiaGrossCollection || 0,
      openingWeekend:
        bo.openingWeekend !== undefined
          ? Number(bo.openingWeekend)
          : currentBox.openingWeekend || 0,
      openingDay:
        bo.openingDay !== undefined
          ? Number(bo.openingDay)
          : currentBox.openingDay || 0,
      currency: bo.currency || currentBox.currency || 'USD',
      verdict:
        bo.verdict !== undefined
          ? String(bo.verdict)
          : computeVerdict(nextBudget, nextWorldwide, currentBox.verdict),
      notes: bo.notes !== undefined ? String(bo.notes) : currentBox.notes || '',
    };
    setField('boxOffice', updatedBoxOffice);
  }

  if (typeof b.trailerKey === 'string') {
    const match = b.trailerKey.match(
      /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/,
    );
    const cleanKey = match ? match[1] : b.trailerKey.trim();
    setField('trailerKey', cleanKey);
  }

  if (Array.isArray(b.songs)) {
    const cleanedSongs = b.songs
      .filter((s) => s && (s.title || s.youtubeKey))
      .map((s, idx) => {
        const rawKey = String(s.youtubeKey || s.key || '').trim();
        const match = rawKey.match(
          /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/,
        );
        const youtubeKey = match ? match[1] : rawKey;
        return {
          id: s.id || youtubeKey || `song-${Date.now()}-${idx}`,
          title: String(s.title || 'Track').trim(),
          youtubeKey,
          artist: String(s.artist || '').trim(),
          composer: String(s.composer || '').trim(),
          lyricist: String(s.lyricist || '').trim(),
          duration: String(s.duration || '').trim(),
          language: String(s.language || doc.originalLanguage || 'en').trim(),
          isOfficial: s.isOfficial !== false,
        };
      });
    setField('songs', cleanedSongs);
  }

  if (Array.isArray(b.videos)) setField('videos', b.videos);
  if (Array.isArray(b.ottProviders)) {
    setField(
      'ottProviders',
      b.ottProviders.map((x) => String(x).toLowerCase().trim()).filter(Boolean),
    );
  }
  if (Array.isArray(b.regions)) {
    setField(
      'regions',
      b.regions.map((x) => String(x).toLowerCase().trim()).filter(Boolean),
    );
  }
  if (Array.isArray(b.directors)) {
    setField(
      'directors',
      b.directors.map((x) => String(x).trim()).filter(Boolean),
    );
  }
  if (Array.isArray(b.musicDirectors)) {
    setField(
      'musicDirectors',
      b.musicDirectors.map((x) => String(x).trim()).filter(Boolean),
    );
  }
  if (Array.isArray(b.genres)) {
    setField('genres', b.genres);
    setField(
      'genreIds',
      b.genres.map((g) => Number(g.id)).filter(Number.isInteger),
    );
  }

  updates.lockedFields = Array.from(locked);
  updates.lastEditedBy = req.user._id;
  updates.lastEditedAt = new Date();

  doc = await Title.findOneAndUpdate(
    { mediaType, tmdbId },
    { $set: updates },
    { new: true },
  );
  res.json({ title: shapeDetail(doc), message: 'Title updated in MongoDB' });
});

export const syncTitleFromTmdb = asyncHandler(async (req, res) => {
  const rawType = String(req.params.type || '').toLowerCase();
  const mediaType = rawType === 'webseries' ? 'tv' : rawType;
  const tmdbId = Number(req.params.tmdbId);
  const unlockAll = req.body?.unlockAll !== false;

  if (unlockAll) {
    await Title.updateOne(
      { mediaType, tmdbId },
      {
        $set: {
          lockedFields: [],
          isCustom: false,
          lastEditedBy: null,
          lastEditedAt: null,
        },
      },
    );
  }

  const doc = await getOrFetchTitle(mediaType, tmdbId, {
    details: true,
    forceRefresh: true,
    resetOverrides: unlockAll,
  });

  res.json({
    title: shapeDetail(doc),
    message:
      'Synced with TMDB — all manual edits replaced with official TMDB data',
  });
});

export const deleteTitleFromDb = asyncHandler(async (req, res) => {
  const rawType = String(req.params.type || '').toLowerCase();
  const mediaType = rawType === 'webseries' ? 'tv' : rawType;
  const tmdbId = Number(req.params.tmdbId);
  const deleted = await Title.findOneAndDelete({ mediaType, tmdbId });
  if (!deleted) throw ApiError.notFound('Title not found in database');
  await Promise.all([
    Review.deleteMany({ type: mediaType, tmdbId }),
    Comment.deleteMany({ type: mediaType, tmdbId }),
  ]);
  res.status(204).end();
});

// ===================== TMDB API keys =====================
export const listKeys = asyncHandler(async (_req, res) => {
  const [keys, inUse] = await Promise.all([
    ApiKey.find().sort('priority createdAt'),
    currentKeyId(),
  ]);
  res.json(keys.map((k) => ({ ...k.toJSON(), inUse: k.id === inUse })));
});

export const addKey = asyncHandler(async (req, res) => {
  const label = String(req.body.label || '').trim();
  const value = String(req.body.key || '').trim();
  if (!label) throw ApiError.badRequest('Label is required');
  if (!TMDB_KEY.test(value))
    throw ApiError.badRequest(
      'Key must be the 32-character TMDB "API Key" (v3)',
    );
  if (await ApiKey.exists({ keyHash: sha256(value) }))
    throw ApiError.conflict('This key was already added');
  if ((await checkKey(value)) === 'invalid')
    throw ApiError.badRequest('TMDB rejected this key');
  const key = await createKeyRecord({
    label,
    value,
    priority: toPriority(req.body.priority) ?? 10,
  });
  refreshKeyCache();
  res.status(201).json({ key });
});

export const updateKey = asyncHandler(async (req, res) => {
  const change = {};
  if (typeof req.body.label === 'string' && req.body.label.trim())
    change.label = req.body.label.trim();
  if (toPriority(req.body.priority))
    change.priority = toPriority(req.body.priority);
  if (typeof req.body.isActive === 'boolean') {
    change.isActive = req.body.isActive;
    if (req.body.isActive)
      Object.assign(change, {
        isValid: true,
        exhaustedUntil: null,
        lastError: null,
      });
  }
  const key = await ApiKey.findByIdAndUpdate(req.params.id, change, {
    new: true,
  });
  if (!key) throw ApiError.notFound('API key not found');
  refreshKeyCache();
  res.json({ key });
});

export const deleteKey = asyncHandler(async (req, res) => {
  if (!(await ApiKey.findByIdAndDelete(req.params.id)))
    throw ApiError.notFound('API key not found');
  refreshKeyCache();
  res.status(204).end();
});

export const testKey = asyncHandler(async (req, res) => {
  const doc = await ApiKey.findById(req.params.id).select('+encryptedKey');
  if (!doc) throw ApiError.notFound('API key not found');
  const { decrypt } = await import('../utils/crypto.js');
  const result = await checkKey(decrypt(doc.encryptedKey));
  if (result === 'valid')
    Object.assign(doc, {
      isValid: true,
      exhaustedUntil: null,
      lastError: null,
    });
  if (result === 'invalid')
    Object.assign(doc, {
      isValid: false,
      lastError: 'TMDB rejected this key (401)',
    });
  await doc.save();
  refreshKeyCache();
  res.json({ result, key: doc });
});

// ===================== 1-Lakh Quota-Balanced Crawler Controls =====================
export const crawlerStatus = asyncHandler(async (_req, res) =>
  res.json(await getCrawlerStatus()),
);

export const crawlerStart = asyncHandler(async (req, res) => {
  startCrawl({
    restart: req.body?.restart === true,
    targetCap: req.body?.targetCap,
    quotasConfig: req.body?.quotasConfig,
    mode: req.body?.mode || 'full',
  });
  res
    .status(202)
    .json({
      message: 'Quota-balanced crawler started',
      status: await getCrawlerStatus(),
    });
});

export const crawlerStop = asyncHandler(async (_req, res) => {
  requestStop();
  res.json({ message: 'Stop requested' });
});

export const crawlerUpdateCap = asyncHandler(async (req, res) => {
  setTargetCap(req.body);
  const updated = getQuotas();
  res.json({
    targetCap: updated.total,
    quotas: updated,
    message: `Quotas updated: Total ${updated.total.toLocaleString()} (Movies: ${updated.movie.toLocaleString()}, TV: ${updated.tv.toLocaleString()}, Web Series: ${updated.webseries.toLocaleString()})`,
  });
});
