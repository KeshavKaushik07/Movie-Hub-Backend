import Title from '../models/Title.js';
import Genre from '../models/Genre.js';
import Review from '../models/Review.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { INDUSTRIES, OTT_PROVIDERS } from '../config/constant.js';
import { tmdbGet } from './tmdb.client.js';
import { logger } from '../utils/logger.js';

// ======================= helpers =======================
const img = (path, size = 'w500') => {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${env.tmdb.imageBase}/${size}${path}`;
};
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
const toInt = (v) => (v !== undefined && v !== '' && Number.isInteger(Number(v)) ? Number(v) : undefined);
const toNum = (v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const toList = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// Map language code -> default industry region tag
const LANG_TO_REGION = {
  en: 'hollywood',
  hi: 'bollywood',
  te: 'tollywood',
  ta: 'kollywood',
  ml: 'mollywood',
  kn: 'sandalwood',
  mr: 'marathi',
  bn: 'bengali',
  pa: 'punjabi',
  gu: 'gujarati',
  ko: 'korean',
  ja: 'japanese',
  zh: 'chinese',
  cn: 'cantonese',
  es: 'spanish',
  fr: 'french',
  tr: 'turkish',
  ur: 'pakistani',
};

// Map TMDB watch provider ID -> our OTT key
const PROVIDER_ID_TO_KEY = new Map();
Object.values(OTT_PROVIDERS).forEach((p) => {
  p.ids.forEach((id) => PROVIDER_ID_TO_KEY.set(id, p.key));
});

// Detect OTT network names for Web Series classification
const WEB_SERIES_NETWORKS = /netflix|amazon|prime video|disney\+|hotstar|apple tv|hulu|hbo|max|jiocinema|sonyliv|zee5|mx player|altbalaji|tvf|voot|aha|hoichoi|crunchyroll|paramount\+|peacock/i;

// ======================= genres =======================
let genreNames = new Map();
export const loadGenres = async () => {
  const list = await Genre.find().lean();
  genreNames = new Map(list.map((g) => [g.tmdbId, g.name]));
};

export async function syncGenres() {
  for (const type of ['movie', 'tv']) {
    const data = await tmdbGet(`/genre/${type}/list`, { language: 'en-US' });
    for (const g of data?.genres || []) {
      await Genre.updateOne({ tmdbId: g.id }, { name: g.name, $addToSet: { mediaTypes: type } }, { upsert: true });
    }
  }
  await loadGenres();
}

// Estimate Box Office verdict automatically when budget & revenue exist

// Deterministic fallback budget & revenue estimator when TMDB returns 0
export const estimateTitleFinancials = (t) => {
  const rawBudget = Number(t?.budget) || 0;
  const rawRevenue = Number(t?.boxOffice?.worldwideCollection || t?.revenue) || 0;
  if (rawBudget > 0 && rawRevenue > 0) {
    return { budget: rawBudget, revenue: rawRevenue, isEstimated: false };
  }
  const seed = Number(t?.tmdbId || t?.id || 101);
  const pop = Math.max(5, Number(t?.popularity) || 18);
  const rating = Math.max(5, Number(t?.voteAverage || t?.siteRating) || 6.8);
  const votes = Math.max(10, Number(t?.voteCount) || 80);
  const lang = String(t?.originalLanguage || 'hi').toLowerCase();

  // Base scale in USD (which converts to ₹ Crores on frontend: $1M = ₹8.35 Cr)
  const isIndian = ['hi', 'te', 'ta', 'ml', 'kn', 'mr', 'bn', 'pa', 'gu'].includes(lang);
  const baseUsd = isIndian
    ? Math.round((4_500_000 + (seed % 19) * 1_200_000 + Math.min(pop, 120) * 180_000) / 100_000) * 100_000
    : Math.round((18_000_000 + (seed % 23) * 3_500_000 + Math.min(pop, 150) * 450_000) / 100_000) * 100_000;

  const estBudget = rawBudget > 0 ? rawBudget : baseUsd;
  const multiplier = Math.max(0.85, (rating / 6.2) * (1.15 + ((seed % 11) * 0.14)) + Math.min(votes / 4000, 1.2));
  const estRevenue = rawRevenue > 0 ? rawRevenue : Math.round((estBudget * multiplier) / 100_000) * 100_000;

  return {
    budget: estBudget,
    revenue: estRevenue,
    isEstimated: rawBudget === 0 || rawRevenue === 0,
  };
};

export const computeVerdict = (budget = 0, revenue = 0, existingVerdict = '') => {
  if (existingVerdict) return existingVerdict;
  if (!revenue || revenue <= 0) return '';
  if (!budget || budget <= 0) return revenue >= 100_000_000 ? 'Blockbuster' : revenue >= 25_000_000 ? 'Super Hit' : 'Hit';
  const ratio = revenue / budget;
  if (ratio >= 4) return 'All-Time Blockbuster';
  if (ratio >= 2.8) return 'Blockbuster';
  if (ratio >= 2.0) return 'Super Hit';
  if (ratio >= 1.4) return 'Hit';
  if (ratio >= 1.1) return 'Above Average';
  if (ratio >= 0.9) return 'Average';
  if (ratio >= 0.5) return 'Flop';
  return 'Disaster';
};

// ======================= TMDB -> our database =======================
export const fromListing = (r, type, extra = {}) => {
  const resolvedType = type || (r.media_type === 'tv' ? 'tv' : 'movie');
  const date = r.release_date || r.first_air_date;
  const d = date ? new Date(date) : null;
  const ok = d && !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1870;
  const lang = r.original_language || 'en';
  const autoRegion = LANG_TO_REGION[lang];

  const isWeb =
    resolvedType === 'tv' &&
    (extra.isWebSeries ||
      (extra.ottKey && Boolean(extra.ottKey)) ||
      (r.origin_country || []).includes('IN') ||
      (r.popularity || 0) > 25);

  return compact({
    tmdbId: r.id,
    mediaType: resolvedType,
    subType: resolvedType === 'tv' ? (isWeb ? 'webseries' : 'tv') : 'movie',
    isWebSeries: isWeb,
    title: r.title || r.name || 'Untitled',
    originalTitle: r.original_title || r.original_name,
    overview: r.overview || '',
    posterPath: r.poster_path || undefined,
    backdropPath: r.backdrop_path || undefined,
    releaseDate: ok ? d : undefined,
    year: ok ? d.getUTCFullYear() : undefined,
    genreIds: r.genre_ids || (r.genres || []).map((g) => g.id) || [],
    originalLanguage: lang,
    voteAverage: r.vote_average || 0,
    voteCount: r.vote_count || 0,
    popularity: r.popularity || 0,
    adult: !!r.adult,
    autoRegion,
  });
};

// Extract certification from movie release_dates or tv content_ratings
const extractCertification = (d, type) => {
  if (type === 'movie') {
    const results = d.release_dates?.results || [];
    const pref = results.find((r) => r.iso_3166_1 === 'IN') || results.find((r) => r.iso_3166_1 === 'US') || results[0];
    const cert = pref?.release_dates?.find((x) => x.certification)?.certification;
    return cert || undefined;
  }
  const results = d.content_ratings?.results || [];
  const pref = results.find((r) => r.iso_3166_1 === 'IN') || results.find((r) => r.iso_3166_1 === 'US') || results[0];
  return pref?.rating || undefined;
};

// Extract watch providers & OTT keys
const extractWatchProviders = (d) => {
  const results = d['watch/providers']?.results || {};
  const regionData = results.IN || results.US || results.GB || Object.values(results)[0] || {};
  const mapList = (arr = []) =>
    arr.map((p) => ({
      id: p.provider_id,
      name: p.provider_name,
      logoPath: p.logo_path,
    }));

  const flatrate = mapList(regionData.flatrate);
  const free = mapList(regionData.free || regionData.ads);
  const rent = mapList(regionData.rent);
  const buy = mapList(regionData.buy);

  const ottKeys = new Set();
  [...flatrate, ...free, ...rent, ...buy].forEach((p) => {
    const key = PROVIDER_ID_TO_KEY.get(p.id);
    if (key) ottKeys.add(key);
    const lower = (p.name || '').toLowerCase();
    if (lower.includes('netflix')) ottKeys.add('netflix');
    else if (lower.includes('prime') || lower.includes('amazon')) ottKeys.add('prime');
    else if (lower.includes('hotstar') || lower.includes('disney')) ottKeys.add('hotstar');
    else if (lower.includes('jio')) ottKeys.add('jiocinema');
    else if (lower.includes('sonyliv') || lower.includes('sony liv')) ottKeys.add('sonyliv');
    else if (lower.includes('zee5')) ottKeys.add('zee5');
    else if (lower.includes('apple')) ottKeys.add('apple');
    else if (lower.includes('hulu')) ottKeys.add('hulu');
    else if (lower.includes('hbo') || lower.includes('max')) ottKeys.add('max');
    else if (lower.includes('crunchyroll')) ottKeys.add('crunchyroll');
    else if (lower.includes('mx player')) ottKeys.add('mxplayer');
  });

  return {
    watchProviders: {
      link: regionData.link || '',
      flatrate,
      free,
      rent,
      buy,
    },
    ottKeys: Array.from(ottKeys),
  };
};

// Extract YouTube trailers, videos, and songs/soundtracks
const extractVideosAndSongs = (d, existingDoc = null) => {
  const rawVideos = (d.videos?.results || []).filter((v) => v.site === 'YouTube' && v.key);
  const videos = rawVideos.slice(0, 30).map((v) => ({
    id: v.id || v.key,
    key: v.key,
    name: v.name || v.type || 'Video',
    site: v.site || 'YouTube',
    type: v.type || 'Clip',
    official: v.official !== false,
    publishedAt: v.published_at ? new Date(v.published_at) : undefined,
  }));

  const trailer =
    videos.find((v) => v.type === 'Trailer' && v.official) ||
    videos.find((v) => v.type === 'Trailer') ||
    videos.find((v) => v.type === 'Teaser') ||
    videos[0];

  const songRegex = /\b(song|music|lyric|lyrical|audio|jukebox|soundtrack|ost|theme|bgm|track|melody|sing|video song|full video)\b/i;
  const extractedSongs = videos
    .filter((v) => songRegex.test(v.name) || songRegex.test(v.type))
    .map((v) => ({
      id: v.id || v.key,
      title: v.name,
      youtubeKey: v.key,
      artist: '',
      composer: '',
      duration: '',
      language: d.original_language || 'en',
      isOfficial: v.official,
    }));

  // Preserve custom songs added by SuperAdmin or merge with extracted songs
  const existingSongs = existingDoc?.songs || [];
  const mergedSongsMap = new Map();
  existingSongs.forEach((s) => mergedSongsMap.set(s.youtubeKey || s.title, s));
  extractedSongs.forEach((s) => {
    if (!mergedSongsMap.has(s.youtubeKey)) mergedSongsMap.set(s.youtubeKey, s);
  });

  return {
    trailerKey: trailer?.key || existingDoc?.trailerKey || undefined,
    videos,
    songs: Array.from(mergedSongsMap.values()),
  };
};

export const fromDetails = (d, type, existingDoc = null) => {
  const locked = new Set(existingDoc?.lockedFields || []);
  const listing = fromListing({ ...d, genre_ids: (d.genres || []).map((g) => g.id) }, type);
  const { autoRegion, ...baseListing } = listing;

  const { watchProviders, ottKeys } = extractWatchProviders(d);
  const { trailerKey, videos, songs } = extractVideosAndSongs(d, existingDoc);

  const networks = (d.networks || []).map((n) => ({ id: n.id, name: n.name, logoPath: n.logo_path }));
  const hasOttNetwork = networks.some((n) => WEB_SERIES_NETWORKS.test(n.name || ''));
  const isWebSeries =
    type === 'tv' && (existingDoc?.isWebSeries || hasOttNetwork || ottKeys.length > 0 || (d.type && /miniseries|scripted/i.test(d.type)));

  const crewList = d.credits?.crew || [];
  const directors =
    type === 'movie'
      ? crewList.filter((c) => c.job === 'Director').map((c) => c.name)
      : (d.created_by || []).map((c) => c.name);
  const writers = crewList
    .filter((c) => ['Writer', 'Screenplay', 'Story'].includes(c.job))
    .map((c) => c.name)
    .slice(0, 6);
  const producers = crewList
    .filter((c) => ['Producer', 'Executive Producer'].includes(c.job))
    .map((c) => c.name)
    .slice(0, 6);
  const musicDirectors = crewList
    .filter((c) => /music|composer|score|song/i.test(c.job || ''))
    .map((c) => c.name)
    .slice(0, 6);

  const budget = d.budget || existingDoc?.budget || 0;
  const revenue = d.revenue || existingDoc?.revenue || 0;
  const existingBox = existingDoc?.boxOffice ? existingDoc.boxOffice.toObject?.() || existingDoc.boxOffice : {};

  const boxOffice = {
    budgetFormatted: existingBox.budgetFormatted || (budget > 0 ? `$${budget.toLocaleString()}` : ''),
    domesticCollection: existingBox.domesticCollection || (revenue > 0 ? Math.round(revenue * 0.42) : 0),
    internationalCollection: existingBox.internationalCollection || (revenue > 0 ? Math.round(revenue * 0.58) : 0),
    worldwideCollection: existingBox.worldwideCollection || revenue || 0,
    indiaNetCollection: existingBox.indiaNetCollection || 0,
    indiaGrossCollection: existingBox.indiaGrossCollection || 0,
    openingWeekend: existingBox.openingWeekend || (revenue > 0 ? Math.round(revenue * 0.22) : 0),
    openingDay: existingBox.openingDay || (revenue > 0 ? Math.round(revenue * 0.08) : 0),
    currency: existingBox.currency || 'USD',
    verdict: computeVerdict(budget, existingBox.worldwideCollection || revenue, existingBox.verdict),
    notes: existingBox.notes || '',
  };

  const tmdbReviews = (d.reviews?.results || []).slice(0, 15).map((r) => ({
    id: r.id,
    author: r.author || r.author_details?.username || 'Reviewer',
    authorAvatar: r.author_details?.avatar_path || null,
    rating: r.author_details?.rating || null,
    content: r.content || '',
    url: r.url || '',
    createdAt: r.created_at ? new Date(r.created_at) : new Date(),
  }));

  const keywordsRaw = d.keywords?.keywords || d.keywords?.results || [];
  const regionsSet = new Set([...(existingDoc?.regions || []), ...(autoRegion ? [autoRegion] : [])]);
  const ottSet = new Set([...(existingDoc?.ottProviders || []), ...ottKeys]);
  networks.forEach((n) => {
    const lower = (n.name || '').toLowerCase();
    if (lower.includes('netflix')) ottSet.add('netflix');
    else if (lower.includes('prime') || lower.includes('amazon')) ottSet.add('prime');
    else if (lower.includes('hotstar') || lower.includes('disney')) ottSet.add('hotstar');
    else if (lower.includes('jio')) ottSet.add('jiocinema');
    else if (lower.includes('sony')) ottSet.add('sonyliv');
    else if (lower.includes('zee')) ottSet.add('zee5');
    else if (lower.includes('apple')) ottSet.add('apple');
    else if (lower.includes('hulu')) ottSet.add('hulu');
    else if (lower.includes('hbo') || lower.includes('max')) ottSet.add('max');
  });

  const candidate = compact({
    ...baseListing,
    subType: type === 'tv' ? (isWebSeries ? 'webseries' : 'tv') : 'movie',
    isWebSeries,
    tagline: d.tagline || undefined,
    status: d.status,
    homepage: d.homepage || undefined,
    imdbId: d.imdb_id || d.external_ids?.imdb_id || undefined,
    certification: extractCertification(d, type),
    runtime: d.runtime || d.episode_run_time?.[0] || undefined,
    genres: (d.genres || []).map(({ id, name }) => ({ id, name })),
    countries: (d.production_countries || []).map((c) => c.name),
    languages: (d.spoken_languages || []).map((l) => l.english_name || l.name).filter(Boolean),
    keywords: keywordsRaw.map((k) => k.name).filter(Boolean).slice(0, 20),
    productionCompanies: (d.production_companies || []).slice(0, 10).map((p) => ({
      id: p.id,
      name: p.name,
      logoPath: p.logo_path,
      country: p.origin_country,
    })),
    networks,
    regions: Array.from(regionsSet),
    ottProviders: Array.from(ottSet),
    budget,
    revenue: boxOffice.worldwideCollection || revenue,
    boxOffice,
    numberOfSeasons: d.number_of_seasons,
    numberOfEpisodes: d.number_of_episodes,
    seasons: (d.seasons || []).map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
      airDate: s.air_date,
      posterPath: s.poster_path,
      overview: s.overview,
      voteAverage: s.vote_average,
    })),
    trailerKey,
    videos,
    songs,
    images: {
      backdrops: (d.images?.backdrops || []).slice(0, 12).map((b) => b.file_path),
      posters: (d.images?.posters || []).slice(0, 8).map((p) => p.file_path),
    },
    watchProviders,
    directors,
    writers,
    producers,
    musicDirectors,
    cast: (d.credits?.cast || []).slice(0, 24).map((c, idx) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      profilePath: c.profile_path,
      order: c.order ?? idx,
    })),
    crew: crewList.slice(0, 20).map((c) => ({
      id: c.id,
      name: c.name,
      job: c.job,
      department: c.department,
      profilePath: c.profile_path,
    })),
    tmdbReviews,
    detailsFetched: true,
    detailsFailed: false,
    detailsFetchedAt: new Date(),
  });

  // Respect SuperAdmin lockedFields so manual edits are never overwritten
  for (const field of locked) {
    delete candidate[field];
  }

  return candidate;
};

/**
 * Bulk upserts a page of TMDB list results into MongoDB.
 * Also applies optional tags (`regionKey`, `ottKey`, `listTag`, `isWebSeries`).
 */
export async function saveListings(results, type, tags = {}) {
  const valid = (results || []).filter((r) => r?.id && (r.title || r.name));
  if (!valid.length) return 0;

  const ops = valid.map((r) => {
    const resolvedType = type || (r.media_type === 'tv' ? 'tv' : 'movie');
    const mapped = fromListing(r, resolvedType, tags);
    const { autoRegion, ...fields } = mapped;

    const addToSet = {};
    const regionsToAdd = [autoRegion, tags.regionKey].filter(Boolean);
    if (regionsToAdd.length) addToSet.regions = { $each: [...new Set(regionsToAdd)] };
    if (tags.ottKey) addToSet.ottProviders = tags.ottKey;
    if (tags.listTag) addToSet.listTags = tags.listTag;

    return {
      updateOne: {
        filter: { mediaType: fields.mediaType, tmdbId: fields.tmdbId },
        update: {
          $setOnInsert: {
            siteRating: 0,
            siteReviewCount: 0,
            criticRating: 0,
            criticReviewCount: 0,
            lockedFields: [],
          },
          $set: fields,
          ...(Object.keys(addToSet).length ? { $addToSet: addToSet } : {}),
        },
        upsert: true,
      },
    };
  });

  await Title.bulkWrite(ops, { ordered: false });
  return ops.length;
}

/**
 * Cache-Aside Title Fetcher:
 * 1. Checks MongoDB first.
 * 2. If present (and has full details when `details: true`), returns immediately from MongoDB!
 * 3. If not in MongoDB (or missing full details), fetches from TMDB, stores in MongoDB (plus caches similar/recommended titles!), and returns.
 */
export async function getOrFetchTitle(type, tmdbId, { details = false, forceRefresh = false } = {}) {
  const normalizedType = type === 'webseries' ? 'tv' : type;
  let doc = await Title.findOne({ mediaType: normalizedType, tmdbId });
  if (doc && (!details || doc.detailsFetched || doc.isCustom) && !forceRefresh) {
    return doc;
  }

  try {
    const data = await tmdbGet(`/${normalizedType}/${tmdbId}`, {
      append_to_response: 'credits,videos,images,watch/providers,reviews,similar,recommendations,release_dates,content_ratings,keywords,external_ids',
      include_image_language: 'en,null,hi',
    });
    if (!data) {
      if (doc) return doc;
      throw ApiError.notFound('Title not found in database or TMDB');
    }

    const updatePayload = fromDetails(data, normalizedType, doc);
    doc = await Title.findOneAndUpdate(
      { mediaType: normalizedType, tmdbId },
      { $set: updatePayload },
      { upsert: true, new: true },
    );

    // Opportunistically cache similar & recommended listings into MongoDB in the background
    const bonusListings = [...(data.similar?.results || []), ...(data.recommendations?.results || [])];
    if (bonusListings.length) {
      saveListings(bonusListings, normalizedType).catch(() => {});
    }
  } catch (err) {
    if (doc) return doc; // Serve existing MongoDB doc if TMDB is offline/unreachable
    throw err;
  }
  return doc;
}

/**
 * Cache-Aside TV Season & Episodes Fetcher:
 * Checks if the season's episodes are already stored in `Title.seasonsDetails` in MongoDB;
 * if not, fetches `/tv/:tmdbId/season/:seasonNumber` from TMDB, stores in MongoDB, and serves.
 */
export async function getOrFetchSeason(tmdbId, seasonNumber) {
  const sNum = Number(seasonNumber);
  let doc = await Title.findOne({ mediaType: 'tv', tmdbId });
  const existing = doc?.seasonsDetails?.find((s) => s.seasonNumber === sNum);
  if (existing && existing.episodes?.length) {
    return existing;
  }

  const data = await tmdbGet(`/tv/${tmdbId}/season/${sNum}`, { language: 'en-US' });
  if (!data) throw ApiError.notFound('Season not found');

  const seasonObj = {
    seasonNumber: data.season_number ?? sNum,
    name: data.name || `Season ${sNum}`,
    overview: data.overview || '',
    airDate: data.air_date || '',
    posterPath: data.poster_path || '',
    episodes: (data.episodes || []).map((ep) => ({
      episodeNumber: ep.episode_number,
      name: ep.name,
      overview: ep.overview,
      airDate: ep.air_date,
      runtime: ep.runtime,
      stillPath: ep.still_path,
      voteAverage: ep.vote_average,
    })),
  };

  if (doc) {
    await Title.updateOne({ _id: doc._id }, { $pull: { seasonsDetails: { seasonNumber: sNum } } });
    await Title.updateOne({ _id: doc._id }, { $push: { seasonsDetails: seasonObj } });
  }
  return seasonObj;
}

// ======================= Shapers (Compatible with both Backend & TMDB Frontend Formats) =======================
export const shapeTitle = (t) => {
  const posterUrl = t.customPosterUrl || img(t.posterPath, 'w500');
  const backdropUrl = t.customBackdropUrl || img(t.backdropPath, 'w1280');
  const releaseStr = t.releaseDate ? new Date(t.releaseDate).toISOString().slice(0, 10) : t.year ? `${t.year}-01-01` : null;
  const genres =
    t.genres?.length > 0
      ? t.genres
      : (t.genreIds || []).map((id) => ({ id, name: genreNames.get(id) })).filter((g) => g.name);

  return {
    id: t.tmdbId,
    tmdbId: t.tmdbId,
    type: t.mediaType,
    media_type: t.mediaType,
    subType: t.subType || t.mediaType,
    isWebSeries: !!t.isWebSeries,
    isCustom: !!t.isCustom,
    title: t.title,
    name: t.title,
    originalTitle: t.originalTitle || t.title,
    overview: (t.overview || '').slice(0, 280),
    posterUrl,
    backdropUrl,
    poster_path: t.customPosterUrl || t.posterPath || null,
    backdrop_path: t.customBackdropUrl || t.backdropPath || null,
    releaseDate: t.releaseDate || null,
    release_date: releaseStr,
    first_air_date: releaseStr,
    year: t.year || null,
    genres,
    genre_ids: t.genreIds || [],
    language: t.originalLanguage || 'en',
    original_language: t.originalLanguage || 'en',
    rating: t.voteAverage || 0,
    vote_average: t.voteAverage || 0,
    votes: t.voteCount || 0,
    vote_count: t.voteCount || 0,
    popularity: t.popularity || 0,
    siteRating: t.siteRating || 0,
    siteReviewCount: t.siteReviewCount || 0,
    criticRating: t.criticRating || 0,
    criticReviewCount: t.criticReviewCount || 0,
    budget: t.budget > 0 ? t.budget : estimateTitleFinancials(t).budget,
    revenue: (t.boxOffice?.worldwideCollection || t.revenue) > 0 ? (t.boxOffice?.worldwideCollection || t.revenue) : estimateTitleFinancials(t).revenue,
     financialEstimated: !(t.budget > 0 && (t.boxOffice?.worldwideCollection || t.revenue) > 0),
    verdict: t.boxOffice?.verdict || computeVerdict(t.budget, t.revenue),
    ottProviders: t.ottProviders || [],
    regions: t.regions || [],
  };
};

export const shapeDetail = (t) => {
  const base = shapeTitle(t);
  const videos = (t.videos || []).map((v) => ({
    ...v,
    url: `https://www.youtube.com/watch?v=${v.key}`,
    embedUrl: `https://www.youtube.com/embed/${v.key}`,
    thumbnailUrl: `https://img.youtube.com/vi/${v.key}/hqdefault.jpg`,
  }));

  const songs = (t.songs || []).map((s, idx) => ({
    id: s.id || s.youtubeKey || `song-${idx}`,
    title: s.title,
    youtubeKey: s.youtubeKey,
    artist: s.artist || '',
    composer: s.composer || (t.musicDirectors || [])[0] || '',
    lyricist: s.lyricist || '',
    duration: s.duration || '',
    language: s.language || t.originalLanguage || 'en',
    isOfficial: s.isOfficial !== false,
    url: s.youtubeKey ? `https://www.youtube.com/watch?v=${s.youtubeKey}` : null,
    embedUrl: s.youtubeKey ? `https://www.youtube.com/embed/${s.youtubeKey}` : null,
    thumbnailUrl: s.youtubeKey ? `https://img.youtube.com/vi/${s.youtubeKey}/hqdefault.jpg` : null,
  }));

  const cast = (t.cast || []).map((c) => ({
    id: c.id,
    name: c.name,
    character: c.character,
    profile_path: c.profilePath,
    photoUrl: img(c.profilePath, 'w185'),
  }));

  const crew = (t.crew || []).map((c) => ({
    id: c.id,
    name: c.name,
    job: c.job,
    department: c.department,
    profile_path: c.profilePath,
    photoUrl: img(c.profilePath, 'w185'),
  }));

  const estFin = estimateTitleFinancials(t);
  const budget = t.budget > 0 ? t.budget : estFin.budget;
  const revenue = (t.boxOffice?.worldwideCollection || t.revenue) > 0 ? (t.boxOffice?.worldwideCollection || t.revenue) : estFin.revenue;
  const profit = revenue > 0 && budget > 0 ? revenue - budget : 0;
  const roiPercent = budget > 0 && revenue > 0 ? Math.round(((revenue - budget) / budget) * 100) : 0;

  const boxOffice = {
    budget,
    revenue,
    budgetFormatted: t.boxOffice?.budgetFormatted || (budget > 0 ? `$${budget.toLocaleString()}` : 'Not Disclosed'),
    domesticCollection: t.boxOffice?.domesticCollection || (revenue > 0 ? Math.round(revenue * 0.42) : 0),
    internationalCollection: t.boxOffice?.internationalCollection || (revenue > 0 ? Math.round(revenue * 0.58) : 0),
    worldwideCollection: revenue,
    indiaNetCollection: t.boxOffice?.indiaNetCollection || 0,
    indiaGrossCollection: t.boxOffice?.indiaGrossCollection || 0,
    openingWeekend: t.boxOffice?.openingWeekend || 0,
    openingDay: t.boxOffice?.openingDay || 0,
    currency: t.boxOffice?.currency || 'USD',
    verdict: computeVerdict(budget, revenue, t.boxOffice?.verdict),
    profit,
    roiPercent,
    notes: t.boxOffice?.notes || '',
  };

  const mapProviderLogos = (arr = []) =>
    arr.map((p) => ({
      ...p,
      logoUrl: img(p.logoPath, 'w92'),
    }));

  return {
    ...base,
    overview: t.overview || '',
    tagline: t.tagline || '',
    runtime: t.runtime || null,
    episode_run_time: t.runtime ? [t.runtime] : [],
    status: t.status || 'Released',
    certification: t.certification || (t.adult ? 'A' : 'UA'),
    imdbId: t.imdbId || null,
    homepage: t.homepage || null,
    countries: t.countries || [],
    languages: t.languages || [],
    keywords: t.keywords || [],
    productionCompanies: (t.productionCompanies || []).map((p) => ({
      ...p,
      logoUrl: img(p.logoPath, 'w185'),
    })),
    networks: (t.networks || []).map((n) => ({
      ...n,
      logoUrl: img(n.logoPath, 'w185'),
    })),
    budget,
    revenue,
    boxOffice,
    numberOfSeasons: t.numberOfSeasons || (t.seasons?.length || 0),
    number_of_seasons: t.numberOfSeasons || (t.seasons?.length || 0),
    numberOfEpisodes: t.numberOfEpisodes || 0,
    number_of_episodes: t.numberOfEpisodes || 0,
    seasons: (t.seasons || []).map((s) => ({
      ...s,
      posterUrl: img(s.posterPath, 'w342'),
    })),
    directors: t.directors || [],
    writers: t.writers || [],
    producers: t.producers || [],
    musicDirectors: t.musicDirectors || [],
    cast,
    crew,
    credits: {
      cast,
      crew: [
        ...(t.directors || []).map((name) => ({ name, job: 'Director', department: 'Directing' })),
        ...(t.musicDirectors || []).map((name) => ({ name, job: 'Original Music Composer', department: 'Sound' })),
        ...crew,
      ],
    },
    trailerKey: t.trailerKey || videos[0]?.key || null,
    trailerUrl: t.trailerKey ? `https://www.youtube.com/watch?v=${t.trailerKey}` : null,
    videos: { results: videos },
    videoList: videos,
    songs,
    images: {
      backdrops: (t.images?.backdrops || []).map((b) => img(b, 'w1280')),
      posters: (t.images?.posters || []).map((p) => img(p, 'w500')),
    },
    watchProviders: {
      link: t.watchProviders?.link || '',
      flatrate: mapProviderLogos(t.watchProviders?.flatrate),
      free: mapProviderLogos(t.watchProviders?.free),
      rent: mapProviderLogos(t.watchProviders?.rent),
      buy: mapProviderLogos(t.watchProviders?.buy),
    },
    tmdbReviews: (t.tmdbReviews || []).map((r) => ({
      ...r,
      avatarUrl: r.authorAvatar
        ? r.authorAvatar.startsWith('/http')
          ? r.authorAvatar.slice(1)
          : img(r.authorAvatar, 'w185')
        : null,
    })),
    lockedFields: t.lockedFields || [],
    hasFullDetails: !!t.detailsFetched,
  };
};

export async function titlesByPairs(pairs) {
  if (!pairs.length) return new Map();
  const docs = await Title.find({ $or: pairs.map((p) => ({ mediaType: p.type, tmdbId: p.tmdbId })) });
  return new Map(docs.map((d) => [`${d.mediaType}:${d.tmdbId}`, shapeTitle(d)]));
}

/** Recalculates both User Community rating and Critic rating on a Title. */
export async function recalcSiteRating(type, tmdbId) {
  const [userAgg, criticAgg] = await Promise.all([
    Review.aggregate([
      { $match: { type, tmdbId, reviewType: { $ne: 'critic' }, isHidden: { $ne: true } } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
    Review.aggregate([
      { $match: { type, tmdbId, reviewType: 'critic', isHidden: { $ne: true } } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
  ]);

  await Title.updateOne(
    { mediaType: type, tmdbId },
    {
      siteRating: userAgg[0] ? Math.round(userAgg[0].avg * 10) / 10 : 0,
      siteReviewCount: userAgg[0]?.count || 0,
      criticRating: criticAgg[0] ? Math.round(criticAgg[0].avg * 10) / 10 : 0,
      criticReviewCount: criticAgg[0]?.count || 0,
    },
  );
}

// ======================= Filters & Cache-Aside Discovery =======================
export const buildFilter = (q) => {
  const f = {};
  if (q.type === 'webseries' || q.subType === 'webseries' || q.isWebSeries === 'true') {
    f.mediaType = 'tv';
    f.$or = [{ isWebSeries: true }, { subType: 'webseries' }, { ottProviders: { $exists: true, $ne: [] } }];
  } else if (['movie', 'tv'].includes(q.type)) {
    f.mediaType = q.type;
  }

  // Support TMDB-style parameters (`with_genres`, `with_original_language`, `primary_release_year`, `first_air_date_year`, `with_watch_providers`)
  const genreParam = q.genre ?? q.with_genres ?? '';
  const genres = toList(genreParam).map(Number).filter(Number.isInteger);
  if (genres.length) f.genreIds = q.genreMode === 'all' ? { $all: genres } : { $in: genres };

  const year = toInt(q.year ?? q.primary_release_year ?? q.first_air_date_year);
  const from = toInt(q.yearFrom);
  const to = toInt(q.yearTo);
  if (year) f.year = year;
  else if (from || to) f.year = compact({ $gte: from, $lte: to });

  const langParam = q.language ?? q.lang ?? q.with_original_language;
  if (langParam && langParam !== 'en-US') {
    f.originalLanguage = { $in: toList(langParam).slice(0, 10) };
  }

  if (q.industry) {
    const ind = String(q.industry).toLowerCase();
    const langs = INDUSTRIES[ind];
    if (langs) {
      f.$and = [...(f.$and || []), { $or: [{ regions: ind }, { originalLanguage: { $in: langs } }] }];
    } else {
      f.regions = ind;
    }
  }

  if (q.ott || q.with_watch_providers) {
    const ottList = toList(q.ott || q.with_watch_providers).map((x) => x.toLowerCase());
    const mappedKeys = ottList.map((k) => PROVIDER_ID_TO_KEY.get(Number(k)) || k);
    f.ottProviders = { $in: mappedKeys };
  }

  const rating = compact({ $gte: toNum(q.minRating ?? q['vote_average.gte']), $lte: toNum(q.maxRating) });
  if (Object.keys(rating).length) f.voteAverage = rating;

  if (toInt(q.minVotes ?? q['vote_count.gte'])) {
    f.voteCount = { $gte: toInt(q.minVotes ?? q['vote_count.gte']) };
  }

  const runtime = compact({ $gte: toInt(q.minRuntime), $lte: toInt(q.maxRuntime) });
  if (Object.keys(runtime).length) f.runtime = runtime;

  if (q.q) {
    const cleanQ = String(q.q).trim().slice(0, 100);
    if (cleanQ) {
      const escaped = cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      f.$and = [
        ...(f.$and || []),
        {
          $or: [
            { title: { $regex: escaped, $options: 'i' } },
            { originalTitle: { $regex: escaped, $options: 'i' } },
            { directors: { $regex: escaped, $options: 'i' } },
            { 'cast.name': { $regex: escaped, $options: 'i' } },
          ],
        },
      ];
    }
  }

  return f;
};

const SORTS = {
  popularity: { popularity: -1 },
  'popularity.desc': { popularity: -1 },
  rating: { voteAverage: -1, voteCount: -1 },
  'vote_average.desc': { voteAverage: -1, voteCount: -1 },
  votes: { voteCount: -1 },
  revenue: { revenue: -1, popularity: -1 },
  budget: { budget: -1, popularity: -1 },
  newest: { releaseDate: -1 },
  'release_date.desc': { releaseDate: -1 },
  oldest: { releaseDate: 1 },
  title: { title: 1 },
  community: { siteRating: -1, siteReviewCount: -1 },
  critic: { criticRating: -1, criticReviewCount: -1 },
};

const LIST_FIELDS =
  'tmdbId mediaType subType isWebSeries isCustom title originalTitle overview posterPath backdropPath customPosterUrl customBackdropUrl releaseDate year genreIds genres originalLanguage voteAverage voteCount popularity siteRating siteReviewCount criticRating criticReviewCount budget revenue boxOffice ottProviders regions';

/**
 * Fetches from TMDB when a frontend query is NOT present in MongoDB, stores in MongoDB, and returns.
 */
async function fetchFromTmdbAndStore(query = {}, listName = null) {
  const rawType = query.type === 'webseries' ? 'tv' : ['movie', 'tv'].includes(query.type) ? query.type : 'movie';
  const page = Math.max(1, toInt(query.page) || 1);

  try {
    // 1. Search query fallback
    if (query.q && String(query.q).trim().length >= 2) {
      const q = String(query.q).trim();
      if (['movie', 'tv'].includes(query.type)) {
        const data = await tmdbGet(`/search/${rawType}`, { query: q, page, include_adult: false });
        if (data?.results?.length) {
          await saveListings(data.results, rawType, { isWebSeries: query.type === 'webseries' });
        }
      } else {
        const [mData, tvData] = await Promise.all([
          tmdbGet('/search/movie', { query: q, page, include_adult: false }),
          tmdbGet('/search/tv', { query: q, page, include_adult: false }),
        ]);
        if (mData?.results?.length) await saveListings(mData.results, 'movie');
        if (tvData?.results?.length) await saveListings(tvData.results, 'tv');
      }
      return;
    }

    // 2. Named list fallback (trending, popular, top-rated, now-playing, upcoming)
    if (listName) {
      const mapCategory = {
        trending: `/trending/${rawType}/week`,
        popular: `/${rawType}/popular`,
        'top-rated': `/${rawType}/top_rated`,
        top_rated: `/${rawType}/top_rated`,
        'now-playing': rawType === 'tv' ? '/tv/on_the_air' : '/movie/now_playing',
        now_playing: rawType === 'tv' ? '/tv/on_the_air' : '/movie/now_playing',
        upcoming: rawType === 'tv' ? '/tv/airing_today' : '/movie/upcoming',
      };
      const endpoint = mapCategory[listName];
      if (endpoint) {
        const data = await tmdbGet(endpoint, { page, language: 'en-US' });
        if (data?.results?.length) {
          await saveListings(data.results, rawType, { listTag: listName });
        }
        return;
      }
    }

    // 3. Discover filter fallback (genre, year, language, industry, OTT provider)
    const params = {
      page,
      sort_by: 'popularity.desc',
      include_adult: false,
      language: 'en-US',
    };
    const genreParam = query.genre ?? query.with_genres;
    if (genreParam) params.with_genres = String(genreParam);

    const year = toInt(query.year ?? query.primary_release_year ?? query.first_air_date_year);
    if (year) {
      params[rawType === 'tv' ? 'first_air_date_year' : 'primary_release_year'] = year;
    }

    const ind = query.industry ? String(query.industry).toLowerCase() : null;
    const lang = query.language ?? query.lang ?? query.with_original_language ?? (ind && INDUSTRIES[ind]?.[0]);
    if (lang && lang !== 'en-US') {
      params.with_original_language = String(lang).split(',')[0];
    }

    const ottKey = query.ott ? String(query.ott).toLowerCase() : null;
    if (ottKey && OTT_PROVIDERS[ottKey]) {
      params.with_watch_providers = OTT_PROVIDERS[ottKey].ids.join('|');
      params.watch_region = OTT_PROVIDERS[ottKey].region || 'IN';
    } else if (query.with_watch_providers) {
      params.with_watch_providers = query.with_watch_providers;
      params.watch_region = query.watch_region || 'IN';
    } else if (query.type === 'webseries') {
      params.with_watch_providers = '8|119|9|122|337|220|237|232|350';
      params.watch_region = 'IN';
    }

    const data = await tmdbGet(`/discover/${rawType}`, params);
    if (data?.results?.length) {
      await saveListings(data.results, rawType, {
        regionKey: ind || undefined,
        ottKey: ottKey || undefined,
        isWebSeries: query.type === 'webseries',
      });
    }
  } catch (err) {
    logger.warn('Cache-aside TMDB fallback warning:', err.message);
  }
}

/**
 * Search + Filter + Sort + Paginate from MongoDB first.
 * If data for the request is not present in MongoDB, automatically calls TMDB, stores in MongoDB, and serves!
 */
export async function findTitles(query = {}, { extra = {}, sort, listName = null, allowTmdbFallback = true } = {}) {
  const page = Math.max(1, toInt(query.page) || 1);
  const limit = Math.min(50, Math.max(1, toInt(query.limit) || 20));
  const skip = (page - 1) * limit;
  if (skip > 50_000) throw ApiError.badRequest('Page too deep: narrow your filters instead');

  // Random pick support (for "I'm Feeling Lucky")
  if (query.sort === 'random') {
    const base = buildFilter(query);
    const sample = await Title.aggregate([{ $match: { adult: { $ne: true }, ...base } }, { $sample: { size: limit } }]);
    const shaped = sample.map(shapeTitle);
    return {
      items: shaped,
      results: shaped,
      page: 1,
      limit,
      total: shaped.length,
      total_results: shaped.length,
      totalPages: 1,
      total_pages: 1,
      source: 'mongodb',
    };
  }

  const runMongoQuery = async () => {
    const base = buildFilter(query);
    let order = sort || SORTS[query.sort] || SORTS[query.sort_by] || SORTS.popularity;
    if (['newest', 'oldest', 'release_date.desc'].includes(query.sort || query.sort_by)) {
      base.releaseDate = { $ne: null };
    }
    if (query.order && order) {
      order = Object.fromEntries(Object.keys(order).map((k) => [k, query.order === 'asc' ? 1 : -1]));
    }
    const filter = { $and: [{ adult: { $ne: true } }, base, extra] };
    const [docs, total] = await Promise.all([
      Title.find(filter).select(LIST_FIELDS).sort(order).skip(skip).limit(limit).lean(),
      Title.countDocuments(filter, { limit: 100_000 }),
    ]);
    return { docs, total };
  };

  let { docs, total } = await runMongoQuery();
  let source = 'mongodb';

  // Stick to main rule: if requested data is not in DB (or too few results on page 1 for search), fetch from TMDB -> store in DB -> serve!
  const needsFallback =
    allowTmdbFallback &&
    (docs.length === 0 || (query.q && page === 1 && docs.length < 5));

  if (needsFallback) {
    await fetchFromTmdbAndStore(query, listName);
    const retry = await runMongoQuery();
    docs = retry.docs;
    total = retry.total;
    source = 'tmdb_cached_to_mongodb';
  }

  const shaped = docs.map(shapeTitle);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    items: shaped,
    results: shaped, // TMDB API response compatibility
    page,
    limit,
    total,
    total_results: total,
    totalPages,
    total_pages: totalPages,
    source,
  };
}

const daysAgo = (n) => new Date(Date.now() - n * 864e5);
export const LISTS = {
  trending: () => ({
    extra: { $or: [{ listTags: 'trending' }, { releaseDate: { $gte: daysAgo(730), $lte: new Date() }, voteCount: { $gte: 5 } }] },
    sort: SORTS.popularity,
  }),
  popular: () => ({ extra: {}, sort: SORTS.popularity }),
  'top-rated': () => ({ extra: { voteCount: { $gte: 200 } }, sort: SORTS.rating }),
  top_rated: () => ({ extra: { voteCount: { $gte: 200 } }, sort: SORTS.rating }),
  'now-playing': () => ({
    extra: { $or: [{ listTags: 'now-playing' }, { releaseDate: { $gte: daysAgo(60), $lte: new Date() } }] },
    sort: SORTS.popularity,
  }),
  now_playing: () => ({
    extra: { $or: [{ listTags: 'now-playing' }, { releaseDate: { $gte: daysAgo(60), $lte: new Date() } }] },
    sort: SORTS.popularity,
  }),
  upcoming: () => ({
    extra: { $or: [{ listTags: 'upcoming' }, { releaseDate: { $gt: new Date() } }] },
    sort: { releaseDate: 1 },
  }),
  'community-top': () => ({ extra: { siteReviewCount: { $gte: 1 } }, sort: SORTS.community }),
  'box-office': () => ({ extra: { revenue: { $gt: 0 } }, sort: SORTS.revenue }),
  webseries: () => ({ extra: { mediaType: 'tv', $or: [{ isWebSeries: true }, { subType: 'webseries' }] }, sort: SORTS.popularity }),
};

export const shapeCard = shapeTitle;

export const getGenresList = async (type) => {
  const filter = ['movie', 'tv'].includes(type) ? { mediaTypes: type } : {};
  return (await Genre.find(filter).sort('name').lean()).map((g) => ({
    id: g.tmdbId,
    name: g.name,
    types: g.mediaTypes,
  }));
};
