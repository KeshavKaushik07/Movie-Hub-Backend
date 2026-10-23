import Title from '../models/Title.js';
import Review from '../models/Review.js';
import asyncHandler from '../utils/asyncHandler.js';
import { parseTitle } from '../utils/title.js';
import { getOrFetchTitle, getOrFetchSeason, shapeDetail, shapeTitle } from '../services/title.service.js';

/**
 * Computes genuinely distinct, relevant similar titles for a given movie/series
 * by combining multi-genre intersection count, language/industry match, director/cast overlap,
 * release era proximity, and a deterministic per-title seed so every movie gets unique recommendations.
 */
const findDistinctSimilarTitles = async (doc, limit = 18) => {
  const type = doc.mediaType || 'movie';
  const tmdbId = doc.tmdbId;
  const genres = Array.isArray(doc.genreIds) ? doc.genreIds : [];
  const regions = Array.isArray(doc.regions) ? doc.regions : [];
  const directors = Array.isArray(doc.directors) ? doc.directors : [];
  const castNames = Array.isArray(doc.cast) ? doc.cast.slice(0, 5).map((c) => c.name).filter(Boolean) : [];
  const lang = doc.originalLanguage || 'en';
  const year = doc.year || 2020;
  const seedPrime = ((Number(tmdbId) || 1) % 89) + 7;

  const matchStage = {
    mediaType: type,
    tmdbId: { $ne: tmdbId },
    adult: { $ne: true },
  };
  if (genres.length) {
    matchStage.$or = [
      { genreIds: { $in: genres } },
      ...(directors.length ? [{ directors: { $in: directors } }] : []),
      ...(castNames.length ? [{ 'cast.name': { $in: castNames } }] : []),
    ];
  }

  const docs = await Title.aggregate([
    { $match: matchStage },
    {
      $addFields: {
        genreOverlap: {
          $size: { $setIntersection: [{ $ifNull: ['$genreIds', []] }, genres] },
        },
        regionOverlap: {
          $size: { $setIntersection: [{ $ifNull: ['$regions', []] }, regions] },
        },
        directorOverlap: {
          $size: { $setIntersection: [{ $ifNull: ['$directors', []] }, directors] },
        },
        sameLang: { $cond: [{ $eq: ['$originalLanguage', lang] }, 1, 0] },
        yearDiff: { $abs: { $subtract: [{ $ifNull: ['$year', year] }, year] } },
        titleJitter: { $mod: [{ $multiply: ['$tmdbId', seedPrime] }, 37] },
      },
    },
    {
      $addFields: {
        similarityScore: {
          $add: [
            { $multiply: ['$genreOverlap', 28] },
            { $multiply: ['$sameLang', 26] },
            { $multiply: ['$regionOverlap', 18] },
            { $multiply: ['$directorOverlap', 40] },
            { $cond: [{ $lte: ['$yearDiff', 6] }, 14, 0] },
            '$titleJitter',
          ],
        },
      },
    },
    { $sort: { similarityScore: -1, voteAverage: -1 } },
    { $limit: limit },
  ]);

  return docs.map(shapeTitle);
};

// GET /titles/:type/:tmdbId -> full details (served from MongoDB if present; fetched from TMDB + stored in MongoDB if not!)
export const getTitle = asyncHandler(async (req, res) => {
  const { type, tmdbId, slug } = parseTitle(req);
  const doc = await getOrFetchTitle(type, tmdbId || slug, { details: true });
  const resolvedType = doc.mediaType || type;
  const resolvedId = doc.tmdbId;

  const [similarItems, criticDocs] = await Promise.all([
    findDistinctSimilarTitles(doc, 18),
    Review.find({ type: resolvedType, tmdbId: resolvedId, reviewType: 'critic', isHidden: { $ne: true } })
      .populate('user', 'name avatarColor role')
      .sort('-isFeatured -createdAt')
      .limit(30)
      .lean(),
  ]);

  const shaped = shapeDetail(doc);
  shaped.similar = { results: similarItems, items: similarItems };
  shaped.criticReviews = criticDocs.map((r) => ({
    id: String(r._id),
    rating: r.rating,
    headline: r.headline,
    text: r.text,
    criticName: r.criticName || r.user?.name || 'Film Critic',
    publication: r.publication || 'Movies Hub Critics',
    externalUrl: r.externalUrl || '',
    isVerifiedCritic: r.isVerifiedCritic !== false,
    isFeatured: !!r.isFeatured,
    createdAt: r.createdAt,
  }));

  res.json({ ...shaped, titleData: shaped, titleObj: shaped, title: shaped.title, detail: shaped });
});

// GET /titles/:type/:tmdbId/similar
export const similarTitles = asyncHandler(async (req, res) => {
  const { type, tmdbId, slug } = parseTitle(req);
  const doc = await getOrFetchTitle(type, tmdbId || slug);
  const shaped = await findDistinctSimilarTitles(doc, 20);
  res.json({ items: shaped, results: shaped });
});

// GET /titles/tv/:tmdbId/season/:seasonNumber
export const getSeason = asyncHandler(async (req, res) => {
  const rawId = req.params.tmdbId;
  const seasonNumber = Number(req.params.seasonNumber);
  const season = await getOrFetchSeason(rawId, seasonNumber);
  res.json({ season });
});
