import Title from '../models/Title.js';
import Featured from '../models/Featured.js';
import Blog from '../models/Blog.js';
import Review from '../models/Review.js';
import Comment from '../models/Comment.js';
import { getOrFetchTitle, shapeTitle, shapeDetail } from './title.service.js';
import { findDistinctSimilarTitles } from '../controller/title.controller.js';

/**
 * Smart Delta-Sync & In-Memory Feed Cache Service
 *
 * Powers selective revalidation between Frontend and Backend:
 * - If 0 items changed since `since`: returns `mode: 'none'` (frontend re-fetches nothing).
 * - If 1..DELTA_THRESHOLD items changed: returns `mode: 'delta'` with ONLY the changed items
 *   so the frontend patches them in-place without re-fetching the whole page.
 * - If > DELTA_THRESHOLD items changed (or structural change like bulk crawl / featured reorder):
 *   returns `mode: 'full'` so the frontend re-fetches the full page.
 */

export const DELTA_THRESHOLD = 10;

let lastStructuralChangeAt = Date.now();
const homeFeedMemoryCache = new Map();
const HOME_CACHE_TTL_MS = 90 * 1000; // 90s server-side memory cache (invalidated immediately on any write)

export const markDataChanged = ({ structural = false } = {}) => {
  if (structural) {
    lastStructuralChangeAt = Date.now();
  }
  homeFeedMemoryCache.clear();
};

export const getCachedHomeFeed = (cacheKey) => {
  const entry = homeFeedMemoryCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > HOME_CACHE_TTL_MS) {
    homeFeedMemoryCache.delete(cacheKey);
    return null;
  }
  return entry.data;
};

export const setCachedHomeFeed = (cacheKey, data) => {
  homeFeedMemoryCache.set(cacheKey, {
    savedAt: Date.now(),
    data,
  });
  if (homeFeedMemoryCache.size > 30) {
    const oldestKey = homeFeedMemoryCache.keys().next().value;
    if (oldestKey) homeFeedMemoryCache.delete(oldestKey);
  }
};

const shapeBlogSummary = (b) => ({
  id: String(b._id),
  title: b.title,
  slug: b.slug,
  subtitle: b.subtitle || '',
  summary: b.summary || String(b.content || '').slice(0, 180),
  category: b.category || 'Editorial',
  coverImage: b.coverImage || b.linkedTitleSnapshot?.backdropUrl || '',
  posterImage: b.posterImage || b.linkedTitleSnapshot?.posterUrl || '',
  linkedTitle: b.linkedTitleSnapshot?.tmdbId ? b.linkedTitleSnapshot : null,
  readTimeMinutes: b.readTimeMinutes || 3,
  likeCount: b.likeCount || b.likes?.length || 0,
  commentCount: b.commentCount || 0,
  publishedAt: b.publishedAt || b.createdAt,
  updatedAt: b.updatedAt,
  authorName: b.author?.name || b.authorName || 'Movies Hub Editorial',
});

/**
 * Evaluates what changed in MongoDB since `since` (epoch ms or ISO string).
 * - When `tmdbId` is supplied, checks that specific Title, its reviews/comments, AND whether
 *   any similar/related titles were newly enriched from TMDB since `since`.
 * - Otherwise, counts changed Titles, Featured slides, and Blogs since `since`.
 */
export const evaluateDeltaChanges = async ({
  since,
  type,
  tmdbId,
  cachedUpdatedAt,
  hasFullDetails,
  cachedBudget,
  cachedRevenue,
  cachedSiteRating,
  threshold = DELTA_THRESHOLD,
} = {}) => {
  const serverTime = Date.now();
  const sinceMs = Number(since) || new Date(since || 0).getTime();

  if (!Number.isFinite(sinceMs) || sinceMs <= 0) {
    return {
      success: true,
      changed: true,
      mode: 'full',
      changedCount: 999,
      serverTime,
    };
  }

  const sinceDate = new Date(sinceMs);
  const maxDelta = Math.min(25, Math.max(1, Number(threshold) || DELTA_THRESHOLD));

  // 1. Single Title Detail Check (when viewing or returning to a specific movie/series)
  if (tmdbId && Number.isInteger(Number(tmdbId))) {
    const normType =
      String(type || '').toLowerCase() === 'webseries' ||
      String(type || '').toLowerCase() === 'tv'
        ? 'tv'
        : 'movie';
    const numId = Number(tmdbId);

    let [titleDoc, recentReview, recentComment, recentlyUpdatedTitles] =
      await Promise.all([
        Title.findOne({ mediaType: normType, tmdbId: numId }).lean(),
        Review.findOne({
          type: normType,
          tmdbId: numId,
          updatedAt: { $gt: sinceDate },
        })
          .select('_id updatedAt')
          .lean(),
        Comment.findOne({
          type: normType,
          tmdbId: numId,
          updatedAt: { $gt: sinceDate },
        })
          .select('_id updatedAt')
          .lean(),
        // Check if any other titles (e.g. Similar Movies clicked by the user) were enriched/updated from TMDB since `sinceDate`
        Title.find({ updatedAt: { $gt: sinceDate } })
          .sort({ updatedAt: -1 })
          .limit(maxDelta)
          .lean(),
      ]);

    // If the title in DB had not yet fetched full details from TMDB, enrich it now!
    if (!titleDoc || (!titleDoc.detailsFetched && !titleDoc.isCustom)) {
      const enriched = await getOrFetchTitle(normType, numId, {
        details: true,
      }).catch(() => null);
      if (enriched) {
        titleDoc = typeof enriched.toObject === 'function' ? enriched.toObject() : enriched;
      }
    }

    if (!titleDoc) {
      return {
        success: true,
        changed: false,
        mode: 'none',
        changedCount: 0,
        serverTime,
      };
    }

    const titleUpdatedMs = titleDoc.updatedAt
      ? new Date(titleDoc.updatedAt).getTime()
      : 0;
    const cachedUpdatedMs = cachedUpdatedAt
      ? new Date(cachedUpdatedAt).getTime()
      : 0;

    // Detect if this movie's own data changed (using exact timestamp mismatch OR field mismatch so clock skew never hides updates)
    const selfTimestampChanged =
      cachedUpdatedMs > 0
        ? titleUpdatedMs !== cachedUpdatedMs
        : titleUpdatedMs > sinceMs;
    const selfFieldsChanged =
      hasFullDetails === false ||
      hasFullDetails === 'false' ||
      (cachedBudget !== undefined && Number(titleDoc.budget || 0) !== Number(cachedBudget)) ||
      (cachedRevenue !== undefined && Number(titleDoc.revenue || 0) !== Number(cachedRevenue)) ||
      (cachedSiteRating !== undefined && Number(titleDoc.siteRating || 0) !== Number(cachedSiteRating));

    const hasAnyChange =
      selfTimestampChanged ||
      selfFieldsChanged ||
      Boolean(recentReview) ||
      Boolean(recentComment) ||
      recentlyUpdatedTitles.length > 0;

    if (!hasAnyChange) {
      return {
        success: true,
        changed: false,
        mode: 'none',
        changedCount: 0,
        serverTime,
      };
    }

    const [similarItems, criticDocs] = await Promise.all([
      findDistinctSimilarTitles(titleDoc, 18),
      Review.find({
        type: normType,
        tmdbId: numId,
        reviewType: 'critic',
        isHidden: { $ne: true },
      })
        .populate('user', 'name avatarColor role')
        .sort('-isFeatured -createdAt')
        .limit(30)
        .lean(),
    ]);

    const detail = shapeDetail(titleDoc);
    detail.similar = { results: similarItems, items: similarItems };
    detail.criticReviews = criticDocs.map((r) => ({
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

    const allUpdatedTitleCards = [
      shapeTitle(titleDoc),
      ...recentlyUpdatedTitles
        .filter((t) => !(t.mediaType === normType && t.tmdbId === numId))
        .map(shapeTitle),
    ];

    const allUpdatedDetails = [
      detail,
      ...recentlyUpdatedTitles
        .filter((t) => !(t.mediaType === normType && t.tmdbId === numId))
        .map(shapeDetail),
    ];

    return {
      success: true,
      changed: true,
      mode: 'delta',
      changedCount: allUpdatedTitleCards.length,
      updatedTitles: allUpdatedTitleCards,
      updatedDetails: allUpdatedDetails,
      reviewsOrCommentsChanged: Boolean(recentReview || recentComment),
      serverTime,
    };
  }

  // 2. Catalog / Page Level Delta Check (Home, Browse, OTT Hub, Blogs, Person)
  if (lastStructuralChangeAt > sinceMs) {
    return {
      success: true,
      changed: true,
      mode: 'full',
      reason: 'structural_update',
      changedCount: maxDelta + 1,
      serverTime,
    };
  }

  const [changedTitlesCount, changedFeaturedCount, changedBlogsCount] =
    await Promise.all([
      Title.countDocuments(
        { updatedAt: { $gt: sinceDate } },
        { limit: maxDelta + 5 },
      ),
      Featured.countDocuments(
        { updatedAt: { $gt: sinceDate } },
        { limit: maxDelta + 5 },
      ),
      Blog.countDocuments(
        { status: 'published', updatedAt: { $gt: sinceDate } },
        { limit: maxDelta + 5 },
      ),
    ]);

  const totalChanged =
    changedTitlesCount + changedFeaturedCount + changedBlogsCount;

  // Case A: Nothing changed on the backend!
  if (totalChanged === 0) {
    return {
      success: true,
      changed: false,
      mode: 'none',
      changedCount: 0,
      serverTime,
    };
  }

  // Case B: A lot of data changed (> threshold) or Featured Hero configuration changed -> Full Page Re-fetch
  if (totalChanged > maxDelta || changedFeaturedCount > 0) {
    return {
      success: true,
      changed: true,
      mode: 'full',
      reason:
        changedFeaturedCount > 0 ? 'featured_updated' : 'bulk_data_changed',
      changedCount: totalChanged,
      serverTime,
    };
  }

  // Case C: Only 1..maxDelta items changed -> Return ONLY the changed items for in-place Delta Patching!
  const [changedTitleDocs, changedBlogDocs] = await Promise.all([
    changedTitlesCount > 0
      ? Title.find({ updatedAt: { $gt: sinceDate } })
          .sort({ updatedAt: -1 })
          .limit(maxDelta)
          .lean()
      : [],
    changedBlogsCount > 0
      ? Blog.find({ status: 'published', updatedAt: { $gt: sinceDate } })
          .populate('author', 'name avatarColor role')
          .sort({ updatedAt: -1 })
          .limit(maxDelta)
          .lean()
      : [],
  ]);

  return {
    success: true,
    changed: true,
    mode: 'delta',
    changedCount: totalChanged,
    updatedTitles: changedTitleDocs.map(shapeTitle),
    updatedDetails: changedTitleDocs.map(shapeDetail),
    updatedBlogs: changedBlogDocs.map(shapeBlogSummary),
    serverTime,
  };
};
