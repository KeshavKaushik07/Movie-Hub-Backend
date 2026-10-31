import Title from '../models/Title.js';
import Genre from '../models/Genre.js';
import Review from '../models/Review.js';
import ApiError from '../utils/ApiError.js';
import { slugifyTitle } from '../utils/title.js';
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
const compact = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
const toInt = (v) =>
  v !== undefined && v !== '' && Number.isInteger(Number(v))
    ? Number(v)
    : undefined;
const toNum = (v) =>
  v !== undefined && v !== '' && Number.isFinite(Number(v))
    ? Number(v)
    : undefined;
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

const GENRE_SLUG_TO_ID = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  'sci-fi': 878,
  scifi: 878,
  'science-fiction': 878,
  thriller: 53,
  war: 10752,
  western: 37,
  'action-adventure': 10759,
  'action-and-adventure': 10759,
  'sci-fi-fantasy': 10765,
  'sci-fi-and-fantasy': 10765,
  reality: 10764,
  kids: 10762,
  soap: 10766,
  talk: 10767,
  'war-politics': 10768,
};

export const resolveBackendGenreIds = (genreParam, mediaType = 'movie') => {
  const tokens = toList(genreParam);
  const ids = [];
  for (const tok of tokens) {
    const num = Number(tok);
    if (Number.isInteger(num) && num > 0) {
      ids.push(num);
      continue;
    }
    const slug = String(tok)
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (mediaType === 'tv') {
      if (slug === 'action' || slug === 'adventure') {
        ids.push(10759, 28, 12);
        continue;
      }
      if (slug === 'sci-fi' || slug === 'scifi' || slug === 'fantasy') {
        ids.push(10765, 878, 14);
        continue;
      }
    }
    if (GENRE_SLUG_TO_ID[slug]) {
      ids.push(GENRE_SLUG_TO_ID[slug]);
    } else {
      for (const [gId, gName] of genreNames.entries()) {
        const gSlug = String(gName)
          .toLowerCase()
          .replace(/&/g, 'and')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (gSlug === slug) ids.push(gId);
      }
    }
  }
  return [...new Set(ids)];
};

const OTT_SLUG_ALIASES = {
  netflix: 'netflix',
  prime: 'prime',
  'prime-video': 'prime',
  'amazon-prime': 'prime',
  'amazon-prime-video': 'prime',
  hotstar: 'hotstar',
  jiohotstar: 'hotstar',
  'jio-hotstar': 'hotstar',
  'disney-hotstar': 'hotstar',
  'disney-plus-hotstar': 'hotstar',
  jiocinema: 'jiocinema',
  'jio-cinema': 'jiocinema',
  sonyliv: 'sonyliv',
  'sony-liv': 'sonyliv',
  zee5: 'zee5',
  'zee-5': 'zee5',
  apple: 'apple',
  'apple-tv': 'apple',
  'apple-tv-plus': 'apple',
  'apple-tv+': 'apple',
  max: 'max',
  'hbo-max': 'max',
  'max-hbo': 'max',
  hbo: 'max',
  hulu: 'hulu',
  crunchyroll: 'crunchyroll',
  mxplayer: 'mxplayer',
  'mx-player': 'mxplayer',
};

export const resolveBackendOttKey = (rawKey = '') => {
  const clean = String(rawKey || '').toLowerCase().trim();
  if (!clean) return '';
  if (PROVIDER_ID_TO_KEY.has(Number(clean))) return PROVIDER_ID_TO_KEY.get(Number(clean));
  if (OTT_SLUG_ALIASES[clean]) return OTT_SLUG_ALIASES[clean];
  const slug = clean.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return OTT_SLUG_ALIASES[slug] || clean;
};


// Detect OTT network names for Web Series classification
const WEB_SERIES_NETWORKS =
  /netflix|amazon|prime video|disney\+|hotstar|apple tv|hulu|hbo|max|jiocinema|sonyliv|zee5|mx player|altbalaji|tvf|voot|aha|hoichoi|crunchyroll|paramount\+|peacock/i;

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
      await Genre.updateOne(
        { tmdbId: g.id },
        { name: g.name, $addToSet: { mediaTypes: type } },
        { upsert: true },
      );
    }
  }
  await loadGenres();
}

// Deterministic fallback budget & revenue estimator when TMDB returns 0
export const estimateTitleFinancials = (t) => {
  const rawBudget = Number(t?.budget) || 0;
  const rawRevenue =
    Number(t?.boxOffice?.worldwideCollection || t?.revenue) || 0;
  if (rawBudget > 0 && rawRevenue > 0) {
    return { budget: rawBudget, revenue: rawRevenue, isEstimated: false };
  }
  const seed = Number(t?.tmdbId || t?.id || 101);
  const pop = Math.max(5, Number(t?.popularity) || 18);
  const rating = Math.max(5, Number(t?.voteAverage || t?.siteRating) || 6.8);
  const votes = Math.max(10, Number(t?.voteCount) || 80);
  const lang = String(t?.originalLanguage || 'hi').toLowerCase();

  const isIndian = [
    'hi',
    'te',
    'ta',
    'ml',
    'kn',
    'mr',
    'bn',
    'pa',
    'gu',
  ].includes(lang);
  const baseUsd = isIndian
    ? Math.round(
        (4_500_000 + (seed % 19) * 1_200_000 + Math.min(pop, 120) * 180_000) /
          100_000,
      ) * 100_000
    : Math.round(
        (18_000_000 + (seed % 23) * 3_500_000 + Math.min(pop, 150) * 450_000) /
          100_000,
      ) * 100_000;

  const estBudget = rawBudget > 0 ? rawBudget : baseUsd;
  const multiplier = Math.max(
    0.85,
    (rating / 6.2) * (1.15 + (seed % 11) * 0.14) + Math.min(votes / 4000, 1.2),
  );
  const estRevenue =
    rawRevenue > 0
      ? rawRevenue
      : Math.round((estBudget * multiplier) / 100_000) * 100_000;

  return {
    budget: estBudget,
    revenue: estRevenue,
    isEstimated: rawBudget === 0 || rawRevenue === 0,
  };
};

export const computeVerdict = (
  budget = 0,
  revenue = 0,
  existingVerdict = '',
) => {
  if (existingVerdict) return existingVerdict;
  if (!revenue || revenue <= 0) return '';
  if (!budget || budget <= 0)
    return revenue >= 100_000_000
      ? 'Blockbuster'
      : revenue >= 25_000_000
        ? 'Super Hit'
        : 'Hit';
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
    const pref =
      results.find((r) => r.iso_3166_1 === 'IN') ||
      results.find((r) => r.iso_3166_1 === 'US') ||
      results[0];
    const cert = pref?.release_dates?.find(
      (x) => x.certification,
    )?.certification;
    return cert || undefined;
  }
  const results = d.content_ratings?.results || [];
  const pref =
    results.find((r) => r.iso_3166_1 === 'IN') ||
    results.find((r) => r.iso_3166_1 === 'US') ||
    results[0];
  return pref?.rating || undefined;
};

// Extract watch providers & OTT keys
const extractWatchProviders = (d) => {
  const results = d['watch/providers']?.results || {};
  const regionData =
    results.IN || results.US || results.GB || Object.values(results)[0] || {};
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
    else if (lower.includes('prime') || lower.includes('amazon'))
      ottKeys.add('prime');
    else if (lower.includes('hotstar') || lower.includes('disney'))
      ottKeys.add('hotstar');
    else if (lower.includes('jio')) ottKeys.add('jiocinema');
    else if (lower.includes('sonyliv') || lower.includes('sony liv'))
      ottKeys.add('sonyliv');
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
  const rawVideos = (d.videos?.results || []).filter(
    (v) => v.site === 'YouTube' && v.key,
  );
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

  const songRegex =
    /\b(song|music|lyric|lyrical|audio|jukebox|soundtrack|ost|theme|bgm|track|melody|sing|video song|full video)\b/i;
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

export const fromDetails = (
  d,
  type,
  existingDoc = null,
  { resetOverrides = false } = {},
) => {
  const baseDoc = resetOverrides ? null : existingDoc;
  const locked = resetOverrides
    ? new Set()
    : new Set(baseDoc?.lockedFields || []);
  const listing = fromListing(
    { ...d, genre_ids: (d.genres || []).map((g) => g.id) },
    type,
  );
  const { autoRegion, ...baseListing } = listing;

  const { watchProviders, ottKeys } = extractWatchProviders(d);
  const { trailerKey, videos, songs } = extractVideosAndSongs(d, baseDoc);

  const networks = (d.networks || []).map((n) => ({
    id: n.id,
    name: n.name,
    logoPath: n.logo_path,
  }));
  const hasOttNetwork = networks.some((n) =>
    WEB_SERIES_NETWORKS.test(n.name || ''),
  );
  const isWebSeries =
    type === 'tv' &&
    (baseDoc?.isWebSeries ||
      hasOttNetwork ||
      ottKeys.length > 0 ||
      (d.type && /miniseries|scripted/i.test(d.type)));

  // Combine standard credits.crew and TV aggregate_credits.crew + created_by so no series/movie filmmaker is missed
  const rawCrewList = [
    ...(d.created_by || []).map((c) => ({
      id: c.id,
      name: c.name,
      job: 'Creator',
      department: 'Directing',
      profile_path: c.profile_path,
    })),
    ...(d.credits?.crew || []),
    ...(d.aggregate_credits?.crew || []).map((c) => ({
      id: c.id,
      name: c.name,
      job: c.job || c.jobs?.[0]?.job || 'Crew',
      department: c.department || 'Production',
      profile_path: c.profile_path,
    })),
  ];

  const directorsSet = new Set(
    [
      ...(type === 'movie'
        ? rawCrewList.filter((c) => c.job === 'Director').map((c) => c.name)
        : [
            ...(d.created_by || []).map((c) => c.name),
            ...rawCrewList
              .filter((c) =>
                ['Director', 'Series Director', 'Creator'].includes(c.job),
              )
              .map((c) => c.name),
          ]),
      ...(!resetOverrides && Array.isArray(baseDoc?.directors)
        ? baseDoc.directors
        : []),
    ].filter(Boolean),
  );
  const directors = Array.from(directorsSet).slice(0, 10);

  const writersSet = new Set(
    [
      ...rawCrewList
        .filter((c) =>
          ['Writer', 'Screenplay', 'Story', 'Book', 'Characters'].includes(
            c.job,
          ),
        )
        .map((c) => c.name),
      ...(!resetOverrides && Array.isArray(baseDoc?.writers)
        ? baseDoc.writers
        : []),
    ].filter(Boolean),
  );
  const writers = Array.from(writersSet).slice(0, 10);

  const producersSet = new Set(
    [
      ...rawCrewList
        .filter((c) => ['Producer', 'Executive Producer'].includes(c.job))
        .map((c) => c.name),
      ...(!resetOverrides && Array.isArray(baseDoc?.producers)
        ? baseDoc.producers
        : []),
    ].filter(Boolean),
  );
  const producers = Array.from(producersSet).slice(0, 10);

  const musicDirectorsSet = new Set(
    [
      ...rawCrewList
        .filter((c) => /music|composer|score|song/i.test(c.job || ''))
        .map((c) => c.name),
      ...(!resetOverrides && Array.isArray(baseDoc?.musicDirectors)
        ? baseDoc.musicDirectors
        : []),
    ].filter(Boolean),
  );
  const musicDirectors = Array.from(musicDirectorsSet).slice(0, 10);

  // Merge credits.cast + TV aggregate_credits.cast + any previously linked actors in baseDoc.cast
  const rawCastList = [
    ...(d.credits?.cast || []),
    ...(d.aggregate_credits?.cast || []).map((c, idx) => ({
      id: c.id,
      name: c.name,
      character: c.character || c.roles?.[0]?.character || '',
      profile_path: c.profile_path,
      order: c.order ?? 24 + idx,
    })),
  ];

  const castMap = new Map();
  rawCastList.forEach((c, idx) => {
    if (!c || !c.name) return;
    const key = c.id ? `id:${c.id}` : `name:${String(c.name).toLowerCase()}`;
    if (!castMap.has(key)) {
      castMap.set(key, {
        id: c.id,
        name: c.name,
        character: c.character || '',
        profilePath: c.profile_path || c.profilePath || null,
        order: c.order ?? idx,
        gender: c.gender || 0,
      });
    } else {
      const prev = castMap.get(key);
      if (!prev.profilePath && (c.profile_path || c.profilePath)) {
        prev.profilePath = c.profile_path || c.profilePath;
      }
      if (!prev.character && c.character) {
        prev.character = c.character;
      }
    }
  });

  // Preserve any actor already linked in existingDoc.cast (e.g. from syncPersonCreditsToMongo) so they are never truncated out
  if (!resetOverrides && Array.isArray(baseDoc?.cast)) {
    baseDoc.cast.forEach((c, idx) => {
      if (!c || !c.name) return;
      const key = c.id ? `id:${c.id}` : `name:${String(c.name).toLowerCase()}`;
      const byNameKey = `name:${String(c.name).toLowerCase()}`;
      const alreadyByName = Array.from(castMap.values()).some(
        (existing) =>
          String(existing.name || '').toLowerCase() ===
          String(c.name).toLowerCase(),
      );
      if (!castMap.has(key) && !castMap.has(byNameKey) && !alreadyByName) {
        castMap.set(key, {
          id: c.id,
          name: c.name,
          character: c.character || '',
          profilePath: c.profilePath || c.profile_path || null,
          order: c.order ?? 60 + idx,
          gender: c.gender || 0,
        });
      }
    });
  }

  const mergedCast = Array.from(castMap.values()).slice(0, 65);

  // Merge crew list prioritizing key creative roles + preserving any previously linked crew in baseDoc.crew
  const crewPriority = (job = '') => {
    const j = String(job).toLowerCase();
    if (j === 'director' || j === 'creator' || j === 'series director')
      return 1;
    if (j.includes('music') || j.includes('composer') || j.includes('score'))
      return 2;
    if (j.includes('writer') || j.includes('screenplay') || j.includes('story'))
      return 3;
    if (j.includes('producer')) return 4;
    if (
      j.includes('photography') ||
      j.includes('cinematography') ||
      j === 'editor'
    )
      return 5;
    return 6;
  };

  const sortedRawCrew = [...rawCrewList].sort(
    (a, b) => crewPriority(a.job) - crewPriority(b.job),
  );
  const crewMap = new Map();
  sortedRawCrew.forEach((c) => {
    if (!c || !c.name) return;
    const key = `${c.id || String(c.name).toLowerCase()}:${String(c.job || 'Crew').toLowerCase()}`;
    if (!crewMap.has(key)) {
      crewMap.set(key, {
        id: c.id,
        name: c.name,
        job: c.job || 'Crew',
        department: c.department || 'Production',
        profilePath: c.profile_path || c.profilePath || null,
        gender: c.gender || 0,
      });
    }
  });

  if (!resetOverrides && Array.isArray(baseDoc?.crew)) {
    baseDoc.crew.forEach((c) => {
      if (!c || !c.name) return;
      const key = `${c.id || String(c.name).toLowerCase()}:${String(c.job || 'Crew').toLowerCase()}`;
      if (!crewMap.has(key)) {
        crewMap.set(key, {
          id: c.id,
          name: c.name,
          job: c.job || 'Crew',
          department: c.department || 'Production',
          profilePath: c.profilePath || c.profile_path || null,
          gender: c.gender || 0,
        });
      }
    });
  }

  const mergedCrew = Array.from(crewMap.values()).slice(0, 50);

  const budget = resetOverrides
    ? Number(d.budget) || 0
    : d.budget || baseDoc?.budget || 0;
  const revenue = resetOverrides
    ? Number(d.revenue) || 0
    : d.revenue || baseDoc?.revenue || 0;
  const existingBox =
    !resetOverrides && baseDoc?.boxOffice
      ? baseDoc.boxOffice.toObject?.() || baseDoc.boxOffice
      : {};

  const boxOffice = {
    budgetFormatted:
      existingBox.budgetFormatted ||
      (budget > 0 ? `$${budget.toLocaleString()}` : ''),
    domesticCollection:
      existingBox.domesticCollection ||
      (revenue > 0 ? Math.round(revenue * 0.42) : 0),
    internationalCollection:
      existingBox.internationalCollection ||
      (revenue > 0 ? Math.round(revenue * 0.58) : 0),
    worldwideCollection: existingBox.worldwideCollection || revenue || 0,
    indiaNetCollection: existingBox.indiaNetCollection || 0,
    indiaGrossCollection: existingBox.indiaGrossCollection || 0,
    openingWeekend:
      existingBox.openingWeekend ||
      (revenue > 0 ? Math.round(revenue * 0.22) : 0),
    openingDay:
      existingBox.openingDay || (revenue > 0 ? Math.round(revenue * 0.08) : 0),
    currency: existingBox.currency || 'USD',
    verdict: computeVerdict(
      budget,
      existingBox.worldwideCollection || revenue,
      existingBox.verdict,
    ),
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
  const regionsSet = new Set([
    ...(baseDoc?.regions || []),
    ...(autoRegion ? [autoRegion] : []),
  ]);
  const ottSet = new Set([...(baseDoc?.ottProviders || []), ...ottKeys]);
  networks.forEach((n) => {
    const lower = (n.name || '').toLowerCase();
    if (lower.includes('netflix')) ottSet.add('netflix');
    else if (lower.includes('prime') || lower.includes('amazon'))
      ottSet.add('prime');
    else if (lower.includes('hotstar') || lower.includes('disney'))
      ottSet.add('hotstar');
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
    tagline: resetOverrides ? d.tagline || '' : d.tagline || undefined,
    status: d.status || 'Released',
    homepage: resetOverrides ? d.homepage || '' : d.homepage || undefined,
    imdbId: d.imdb_id || d.external_ids?.imdb_id || undefined,
    certification: resetOverrides
      ? extractCertification(d, type) || ''
      : extractCertification(d, type),
    runtime: resetOverrides
      ? d.runtime || d.episode_run_time?.[0] || 0
      : d.runtime || d.episode_run_time?.[0] || undefined,
    genres: (d.genres || []).map(({ id, name }) => ({ id, name })),
    countries: (d.production_countries || []).map((c) => c.name),
    languages: (d.spoken_languages || [])
      .map((l) => l.english_name || l.name)
      .filter(Boolean),
    keywords: keywordsRaw
      .map((k) => k.name)
      .filter(Boolean)
      .slice(0, 20),
    productionCompanies: (d.production_companies || [])
      .slice(0, 10)
      .map((p) => ({
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
    numberOfSeasons: d.number_of_seasons || (d.seasons || []).filter((s) => Number(s.season_number) > 0).length || (d.seasons || []).length || undefined,
    numberOfEpisodes: d.number_of_episodes,
    seasons: (d.seasons || []).map((s, idx) => ({
      seasonNumber: s.season_number ?? s.seasonNumber ?? idx + 1,
      name: s.name || `Season ${s.season_number ?? idx + 1}`,
      episodeCount: s.episode_count ?? s.episodeCount ?? 0,
      airDate: s.air_date || s.airDate || "",
      posterPath: s.poster_path || s.posterPath || "",
      overview: s.overview || "",
      voteAverage: s.vote_average ?? s.voteAverage ?? 0,
    })),
    ...(d["season/1"] && Array.isArray(d["season/1"].episodes) && d["season/1"].episodes.length > 0
      ? {
          seasonsDetails: [
            ...(Array.isArray(baseDoc?.seasonsDetails)
              ? baseDoc.seasonsDetails
                  .map((sd) => (typeof sd?.toObject === "function" ? sd.toObject() : sd?._doc || sd))
                  .filter((sd) => Number(sd?.seasonNumber) !== 1)
              : []),
            {
              seasonNumber: d["season/1"].season_number ?? 1,
              name: d["season/1"].name || "Season 1",
              overview: d["season/1"].overview || "",
              airDate: d["season/1"].air_date || "",
              posterPath: d["season/1"].poster_path || "",
              episodes: d["season/1"].episodes.map((ep, idx) => ({
                episodeNumber: ep.episode_number ?? idx + 1,
                name: ep.name || `Episode ${ep.episode_number ?? idx + 1}`,
                overview: ep.overview || "",
                airDate: ep.air_date || "",
                runtime: ep.runtime || null,
                stillPath: ep.still_path || "",
                voteAverage: ep.vote_average || 0,
              })),
            },
          ],
        }
      : {}),
    trailerKey: resetOverrides ? trailerKey || '' : trailerKey,
    videos,
    songs,
    images: {
      backdrops: (d.images?.backdrops || [])
        .slice(0, 12)
        .map((b) => b.file_path),
      posters: (d.images?.posters || []).slice(0, 8).map((p) => p.file_path),
    },
    watchProviders,
    directors,
    writers,
    producers,
    musicDirectors,
    cast: mergedCast,
    crew: mergedCrew,
    tmdbReviews,
    detailsFetched: true,
    detailsFailed: false,
    detailsFetchedAt: new Date(),
    ...(resetOverrides
      ? {
          posterPath: d.poster_path || '',
          backdropPath: d.backdrop_path || '',
          lockedFields: [],
          isCustom: false,
          lastEditedBy: null,
          lastEditedAt: null,
        }
      : {}),
  });

  // Respect SuperAdmin lockedFields so manual edits are never overwritten (unless resetOverrides is true)
  if (!resetOverrides) {
    for (const field of locked) {
      delete candidate[field];
    }
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
    if (regionsToAdd.length)
      addToSet.regions = { $each: [...new Set(regionsToAdd)] };
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

const KEY_CREW_JOBS = new Set([
  'Director',
  'Series Director',
  'Creator',
  'Writer',
  'Screenplay',
  'Story',
  'Producer',
  'Executive Producer',
  'Original Music Composer',
  'Music',
  'Music Director',
  'Composer',
  'Director of Photography',
  'Editor',
]);

/**
 * Resolves an actor/actress/director on TMDB, saves their genuine Movie & Web Series credits
 * into MongoDB, AND explicitly injects the person into `cast` / `crew` / `directors` / `musicDirectors`
 * on each credited document in MongoDB so that every returned movie or series is guaranteed to
 * show that person in its Cast & Crew!
 */
const INDIAN_LANGS_SET = new Set(['hi', 'te', 'ta', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu', 'ur']);

const normalizePersonNameForMatch = (s = '') =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const namesMatch = (a, b, alsoKnownAs = []) => {
  const na = normalizePersonNameForMatch(a);
  const nb = normalizePersonNameForMatch(b);
  if (!na || !nb) return false;
  if (na === nb || na.replace(/\s+/g, '') === nb.replace(/\s+/g, '')) return true;
  const wordsA = na.split(' ').filter((w) => w.length > 1);
  const wordsB = nb.split(' ').filter((w) => w.length > 1);
  if (wordsA.length >= 1 && wordsB.length >= 1) {
    if (wordsA.every((w) => wordsB.includes(w)) || wordsB.every((w) => wordsA.includes(w))) {
      return true;
    }
  }
  for (const alias of alsoKnownAs || []) {
    const nAlias = normalizePersonNameForMatch(alias);
    if (nAlias && (nAlias === na || nAlias.replace(/\s+/g, '') === na.replace(/\s+/g, ''))) {
      return true;
    }
  }
  return false;
};

const rankPersonCandidate = (p) => {
  const pop = Number(p?.popularity) || 0;
  const knownVotes = (p?.known_for || []).reduce(
    (sum, k) => sum + (Number(k?.vote_count) || 0),
    0,
  );
  const knownPop = (p?.known_for || []).reduce(
    (sum, k) => sum + (Number(k?.popularity) || 0),
    0,
  );
  const hasPhoto = p?.profile_path ? 40 : 0;
  return pop * 25 + knownVotes / 8 + knownPop * 2 + hasPhoto;
};

export async function syncPersonCreditsToMongo({
  name = '',
  id = null,
  fromSearch = false,
} = {}) {
  const cleanName = String(name || '').trim();
  const normQueryName = normalizePersonNameForMatch(cleanName);
  let tmdbPersonId =
    Number.isInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;

  let personMeta = {
    id: tmdbPersonId,
    name: cleanName || 'Artist',
    profilePath: null,
    profileUrl: null,
    knownForDepartment: 'Acting',
    gender: 0,
    biography: '',
    birthday: null,
    placeOfBirth: '',
    popularity: 0,
  };

  try {
    let pData = null;

    // 1. If an ID was passed, fetch `/person/:id` AND verify its name actually matches `cleanName`!
    //    If `id` belongs to a different person (e.g. a stale/wrong ID), discard it and search by name!
    if (tmdbPersonId) {
      pData = await tmdbGet(`/person/${tmdbPersonId}`, {
        append_to_response: 'combined_credits',
      }).catch(() => null);

      if (
        pData &&
        cleanName.length >= 2 &&
        !namesMatch(cleanName, pData.name, pData.also_known_as)
      ) {
        pData = null;
        tmdbPersonId = null;
      }
    }

    // 2. Search by name on TMDB and sort candidates by popularity + known_for vote counts
    if (!pData && cleanName.length >= 2) {
      const searchRes = await tmdbGet('/search/person', {
        query: cleanName,
        page: 1,
        include_adult: false,
      });
      const rawCandidates = searchRes?.results || [];
      if (!rawCandidates.length) return null;

      const candidates = [...rawCandidates].sort(
        (a, b) => rankPersonCandidate(b) - rankPersonCandidate(a),
      );

      const normQCompact = normQueryName.replace(/\s+/g, '');
      const exactMatches = candidates.filter((p) => {
        const n = normalizePersonNameForMatch(p.name);
        return n === normQueryName || n.replace(/\s+/g, '') === normQCompact;
      });

      const best =
        exactMatches[0] ||
        candidates.find((p) => {
          const n = normalizePersonNameForMatch(p.name);
          const words = n.split(/\s+/);
          return (
            normQueryName.length >= 3 &&
            (n.startsWith(normQueryName) ||
              n.endsWith(normQueryName) ||
              words.includes(normQueryName) ||
              normQueryName.includes(n)) &&
            (p.popularity || 0) >= 1.2
          );
        }) ||
        (!fromSearch ? candidates[0] : null);

      if (!best) return null;

      tmdbPersonId = best.id;
      pData = await tmdbGet(`/person/${tmdbPersonId}`, {
        append_to_response: 'combined_credits',
      });
    }

    if (!pData) return null;

    personMeta.id = pData.id || tmdbPersonId;
    // Keep display name consistent with the matched person
    personMeta.name = pData.name || personMeta.name;
    personMeta.knownForDepartment =
      pData.known_for_department || personMeta.knownForDepartment;
    personMeta.biography = pData.biography || '';
    personMeta.birthday = pData.birthday || null;
    personMeta.placeOfBirth = pData.place_of_birth || '';
    if (pData.gender) personMeta.gender = pData.gender;
    personMeta.popularity =
      Number(pData.popularity) || personMeta.popularity || 0;
    if (pData.profile_path) {
      personMeta.profilePath = pData.profile_path;
      personMeta.profileUrl = img(pData.profile_path, 'w500');
    }

    const allRawCast = pData.combined_credits?.cast || [];
    const indianMovieCount = allRawCast.filter(
      (c) =>
        c?.media_type === 'movie' &&
        INDIAN_LANGS_SET.has(String(c.original_language || '').toLowerCase()),
    ).length;
    const isIndianStar =
      indianMovieCount >= 4 ||
      /india|mumbai|delhi|punjab|chennai|hyderabad|kerala|bangalore|bengaluru|kolkata|amritsar|madras/i.test(
        personMeta.placeOfBirth || '',
      );

    // Filter out non-acting talk show / news / reality / archive-footage / self appearances
    const rawCastCredits = allRawCast.filter((c) => {
      if (!c || !c.id || !(c.title || c.name) || c.adult) return false;
      if (!['movie', 'tv'].includes(c.media_type)) return false;
      const gIds = c.genre_ids || [];
      if (
        gIds.includes(10767) ||
        gIds.includes(10763) ||
        gIds.includes(10764) ||
        gIds.includes(10766) ||
        gIds.includes(99)
      ) {
        return false;
      }
      const charStr = String(c.character || '').trim();
      if (
        /\b(archive footage|archive|uncredited|himself|herself|self|guest|host|contestant|judge|narrator|presenter|award)\b/i.test(
          charStr,
        )
      ) {
        return false;
      }
      if (c.media_type === 'tv') {
        if (!charStr) return false;
        const epCount = Number(c.episode_count || 0);
        const order = c.order ?? 99;
        if (epCount <= 1 && order > 4) return false;
        const lang = String(c.original_language || '').toLowerCase();
        if (isIndianStar && !INDIAN_LANGS_SET.has(lang) && epCount < 3) {
          return false;
        }
      }
      return true;
    });

    const rawCrewCredits = (pData.combined_credits?.crew || []).filter((c) => {
      if (!c || !c.id || !(c.title || c.name) || c.adult) return false;
      if (!['movie', 'tv'].includes(c.media_type)) return false;
      const gIds = c.genre_ids || [];
      if (
        gIds.includes(10767) ||
        gIds.includes(10763) ||
        gIds.includes(10764) ||
        gIds.includes(99)
      ) {
        return false;
      }
      return KEY_CREW_JOBS.has(c.job);
    });

    const scoreCredit = (c) =>
      (Number(c.popularity) || 0) * 2 + (Number(c.vote_count) || 0) / 50;
    const creditMap = new Map();

    rawCastCredits.forEach((c) => {
      const key = `${c.media_type}:${c.id}`;
      const existing = creditMap.get(key);
      if (!existing) {
        creditMap.set(key, {
          item: c,
          mediaType: c.media_type,
          tmdbId: Number(c.id),
          isCast: true,
          character: c.character || '',
          order: c.order ?? 10,
          crewJobs: [],
          score: scoreCredit(c),
        });
      } else {
        existing.isCast = true;
        if (!existing.character && c.character)
          existing.character = c.character;
      }
    });

    rawCrewCredits.forEach((c) => {
      const key = `${c.media_type}:${c.id}`;
      const existing = creditMap.get(key);
      if (
        !existing &&
        personMeta.knownForDepartment === 'Acting' &&
        rawCastCredits.length >= 25 &&
        !['Director', 'Series Director', 'Creator'].includes(c.job)
      ) {
        return;
      }
      if (!existing) {
        creditMap.set(key, {
          item: c,
          mediaType: c.media_type,
          tmdbId: Number(c.id),
          isCast: false,
          character: '',
          order: 99,
          crewJobs: [
            { job: c.job || 'Crew', department: c.department || 'Production' },
          ],
          score: scoreCredit(c),
        });
      } else if (c.job && !existing.crewJobs.some((j) => j.job === c.job)) {
        existing.crewJobs.push({
          job: c.job,
          department: c.department || 'Production',
        });
      }
    });

    const sortedCredits = Array.from(creditMap.values()).sort(
      (a, b) => b.score - a.score,
    );
    const movieEntries = sortedCredits
      .filter((e) => e.mediaType === 'movie')
      .slice(0, 75);
    const tvEntries = sortedCredits
      .filter((e) => e.mediaType === 'tv')
      .slice(0, 30);
    const selectedEntries = [...movieEntries, ...tvEntries];

    // Clean up any previously polluted homonym cast/crew entries in MongoDB
    const safePersonName = String(personMeta.name || cleanName).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
    if (safePersonName && personMeta.id) {
      const nameRx = new RegExp(`^${safePersonName}$`, 'i');
      const validMovieIds = movieEntries.map((e) => e.tmdbId);
      const validTvIds = tvEntries.map((e) => e.tmdbId);
      await Promise.all([
        Title.updateMany(
          {
            'cast.name': nameRx,
            $or: [
              { 'cast.id': { $ne: personMeta.id } },
              { mediaType: 'movie', tmdbId: { $nin: validMovieIds }, isCustom: { $ne: true } },
              { mediaType: 'tv', tmdbId: { $nin: validTvIds }, isCustom: { $ne: true } },
            ],
          },
          { $pull: { cast: { name: nameRx } } },
        ).catch(() => {}),
        Title.updateMany(
          {
            'crew.name': nameRx,
            'crew.id': { $ne: personMeta.id },
          },
          { $pull: { crew: { name: nameRx, id: { $ne: personMeta.id } } } },
        ).catch(() => {}),
      ]);
    }

    if (!selectedEntries.length) {
      return { personMeta, creditPairs: [] };
    }

    await Promise.all([
      movieEntries.length
        ? saveListings(
            movieEntries.map((e) => e.item),
            'movie',
          )
        : null,
      tvEntries.length
        ? saveListings(
            tvEntries.map((e) => e.item),
            'tv',
          )
        : null,
    ]);

    const creditPairs = selectedEntries.map((e) => ({
      mediaType: e.mediaType,
      tmdbId: e.tmdbId,
    }));

    const existingDocs = await Title.find({ $or: creditPairs })
      .select(
        'mediaType tmdbId cast crew directors writers producers musicDirectors',
      )
      .lean();
    const docMap = new Map(
      existingDocs.map((d) => [`${d.mediaType}:${d.tmdbId}`, d]),
    );

    const memberOps = [];
    const lowerPersonName = String(personMeta.name).toLowerCase();

    for (const entry of selectedEntries) {
      const doc = docMap.get(`${entry.mediaType}:${entry.tmdbId}`);
      if (!doc) continue;

      const setFields = {};
      const addToSetFields = {};

      if (entry.isCast) {
        const currentCast = Array.isArray(doc.cast) ? [...doc.cast] : [];
        const idx = currentCast.findIndex(
          (c) =>
            (personMeta.id && c.id === personMeta.id) ||
            String(c.name || '').toLowerCase() === lowerPersonName,
        );
        if (idx === -1) {
          currentCast.push({
            id: personMeta.id,
            name: personMeta.name,
            character: entry.character || '',
            profilePath: personMeta.profilePath || null,
            order: entry.order ?? currentCast.length,
            gender: personMeta.gender || 0,
          });
          setFields.cast = currentCast;
        } else {
          const existingCastMember = currentCast[idx];
          if (
            existingCastMember.id !== personMeta.id ||
            (!existingCastMember.profilePath && personMeta.profilePath) ||
            (!existingCastMember.character && entry.character)
          ) {
            currentCast[idx] = {
              ...existingCastMember,
              id: personMeta.id,
              name: personMeta.name,
              character: existingCastMember.character || entry.character || '',
              profilePath:
                personMeta.profilePath ||
                existingCastMember.profilePath ||
                null,
              gender: personMeta.gender || existingCastMember.gender || 0,
            };
            setFields.cast = currentCast;
          }
        }
      }

      if (entry.crewJobs.length > 0) {
        const currentCrew = Array.isArray(doc.crew) ? [...doc.crew] : [];
        let crewChanged = false;

        for (const cj of entry.crewJobs) {
          const exists = currentCrew.some(
            (c) =>
              ((personMeta.id && c.id === personMeta.id) ||
                String(c.name || '').toLowerCase() === lowerPersonName) &&
              String(c.job || '').toLowerCase() ===
                String(cj.job || '').toLowerCase(),
          );
          if (!exists) {
            currentCrew.push({
              id: personMeta.id,
              name: personMeta.name,
              job: cj.job,
              department: cj.department || 'Production',
              profilePath: personMeta.profilePath || null,
              gender: personMeta.gender || 0,
            });
            crewChanged = true;
          }

          if (['Director', 'Series Director', 'Creator'].includes(cj.job)) {
            addToSetFields.directors = personMeta.name;
          } else if (['Writer', 'Screenplay', 'Story'].includes(cj.job)) {
            addToSetFields.writers = personMeta.name;
          } else if (['Producer', 'Executive Producer'].includes(cj.job)) {
            addToSetFields.producers = personMeta.name;
          } else if (/music|composer|score/i.test(cj.job || '')) {
            addToSetFields.musicDirectors = personMeta.name;
          }
        }

        if (crewChanged) {
          setFields.crew = currentCrew;
        }
      }

      if (
        Object.keys(setFields).length > 0 ||
        Object.keys(addToSetFields).length > 0
      ) {
        memberOps.push({
          updateOne: {
            filter: { mediaType: entry.mediaType, tmdbId: entry.tmdbId },
            update: {
              ...(Object.keys(setFields).length ? { $set: setFields } : {}),
              ...(Object.keys(addToSetFields).length
                ? { $addToSet: addToSetFields }
                : {}),
            },
          },
        });
      }
    }

    if (memberOps.length > 0) {
      await Title.bulkWrite(memberOps, { ordered: false });
    }

    return { personMeta, creditPairs };
  } catch (err) {
    logger.warn('syncPersonCreditsToMongo warning:', err.message);
    return null;
  }
}

/**
 * Cache-Aside Title Fetcher:
 * 1. Checks MongoDB first.
 * 2. If present (and has full details when `details: true`), returns immediately from MongoDB!
 * 3. If not in MongoDB (or missing full details), fetches from TMDB, stores in MongoDB (plus caches similar/recommended titles!), and returns.
 */
async function resolveTitleBySlug(normalizedType, rawSlug) {
  const cleanSlug = slugifyTitle(rawSlug);
  const words = cleanSlug.split('-').filter(Boolean);
  if (!words.length) return null;

  const escapedWords = words.map((w) =>
    w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const flexRegex = new RegExp(
    `^[^a-zA-Z0-9]*${escapedWords.join('[^a-zA-Z0-9]+')}[^a-zA-Z0-9]*$`,
    'i',
  );
  const broadRegex = new RegExp(escapedWords.join('.*'), 'i');

  let candidates = await Title.find({
    mediaType: normalizedType,
    $or: [{ title: flexRegex }, { originalTitle: flexRegex }],
  })
    .sort('-popularity -voteCount')
    .limit(10);

  if (!candidates.length) {
    candidates = await Title.find({
      $or: [{ title: flexRegex }, { originalTitle: flexRegex }],
    })
      .sort('-popularity -voteCount')
      .limit(10);
  }

  if (!candidates.length) {
    candidates = await Title.find({
      $or: [{ title: broadRegex }, { originalTitle: broadRegex }],
    })
      .sort('-popularity -voteCount')
      .limit(15);
  }

  const exactMatch =
    candidates.find(
      (c) =>
        slugifyTitle(c.title) === cleanSlug ||
        slugifyTitle(c.originalTitle) === cleanSlug,
    ) || candidates[0];

  if (exactMatch) return exactMatch;

  const queryText = words.join(' ');
  const typesToTry =
    normalizedType === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];
  for (const tType of typesToTry) {
    try {
      const sData = await tmdbGet(`/search/${tType}`, {
        query: queryText,
        page: 1,
      });
      const results = sData?.results || [];
      if (results.length > 0) {
        await saveListings(results, tType);
        const picked =
          results.find(
            (r) =>
              slugifyTitle(r.title || r.name) === cleanSlug ||
              slugifyTitle(r.original_title || r.original_name) === cleanSlug,
          ) || results[0];
        if (picked?.id) {
          return await Title.findOne({
            mediaType: tType,
            tmdbId: Number(picked.id),
          });
        }
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

export async function getOrFetchTitle(
  type,
  tmdbIdOrSlug,
  { details = false, forceRefresh = false, resetOverrides = false, explicitById = false } = {},
) {
  const rawTypeStr = String(type || 'movie').toLowerCase().trim();
  let normalizedType = ['webseries', 'web-series', 'tv', 'tv-show', 'tv-shows', 'tv-series', 'series'].includes(rawTypeStr)
    ? 'tv'
    : 'movie';
  const rawParamStr = String(tmdbIdOrSlug || '').trim();
  let numericId = Number(rawParamStr);
  let doc = null;

  if (
    !Number.isInteger(numericId) ||
    numericId <= 0 ||
    !/^\d+$/.test(rawParamStr)
  ) {
    doc = await resolveTitleBySlug(normalizedType, rawParamStr);
    if (!doc) {
      throw ApiError.notFound('Title not found for this name');
    }
    normalizedType = doc.mediaType || normalizedType;
    numericId = doc.tmdbId;
  } else {
    // If the URL parameter is a pure number (like `/movie/24`, `/movie/83`, `/movie/96`, `/movie/300`, `/movie/1917`, `/movie/2012`)
    // and was NOT explicitly requested via `?byId=true`, check if MongoDB has a movie whose exact title is that number!
    if (!explicitById) {
      const exactNumericTitleDoc = await Title.findOne({
        mediaType: normalizedType,
        $or: [
          { title: rawParamStr },
          { originalTitle: rawParamStr },
        ],
      }).sort({ popularity: -1, voteCount: -1 });
      if (exactNumericTitleDoc) {
        doc = exactNumericTitleDoc;
        numericId = exactNumericTitleDoc.tmdbId;
      }
    }
    if (!doc) {
      doc = await Title.findOne({ mediaType: normalizedType, tmdbId: numericId });
    }
  }

  const needsSeasonEnrichment =
    details &&
    normalizedType === 'tv' &&
    !doc?.isCustom &&
    (!Array.isArray(doc?.seasons) || doc.seasons.length === 0);

  if (
    doc &&
    (!details || (doc.detailsFetched && !needsSeasonEnrichment) || doc.isCustom) &&
    !forceRefresh
  ) {
    return doc;
  }

  try {
    const appendFields =
      normalizedType === 'tv'
        ? 'credits,aggregate_credits,videos,images,watch/providers,reviews,similar,recommendations,release_dates,content_ratings,keywords,external_ids,season/1'
        : 'credits,videos,images,watch/providers,reviews,similar,recommendations,release_dates,content_ratings,keywords,external_ids';

    const data = await tmdbGet(`/${normalizedType}/${numericId}`, {
      append_to_response: appendFields,
      include_image_language: 'en,null,hi',
    });
    if (!data) {
      if (doc) return doc;
      throw ApiError.notFound('Title not found in database or TMDB');
    }

    const updatePayload = fromDetails(
      data,
      normalizedType,
      resetOverrides ? null : doc,
      { resetOverrides },
    );
    doc = await Title.findOneAndUpdate(
      { mediaType: normalizedType, tmdbId: numericId },
      { $set: updatePayload },
      { upsert: true, new: true },
    );

    const bonusListings = [
      ...(data.similar?.results || []),
      ...(data.recommendations?.results || []),
    ];
    if (bonusListings.length) {
      saveListings(bonusListings, normalizedType).catch(() => {});
    }
  } catch (err) {
    if (doc) return doc;
    throw err;
  }
  return doc;
}

// Helper: Safely unwrap Mongoose Documents & Embedded Subdocuments so object spreads never lose getters into _doc
const toPlain = (obj) => {
  if (!obj || typeof obj !== 'object') return obj || {};
  if (typeof obj.toObject === 'function') return obj.toObject({ getters: false, virtuals: false });
  if (obj._doc && typeof obj._doc === 'object') return obj._doc;
  return obj;
};

export const shapeSeasonDetail = (rawSeason, fallbackSeasonMeta = null, defaultSeasonNum = 1) => {
  const s = toPlain(rawSeason);
  const meta = toPlain(fallbackSeasonMeta);
  const resolvedNum =
    s.seasonNumber !== undefined && s.seasonNumber !== null
      ? Number(s.seasonNumber)
      : s.season_number !== undefined && s.season_number !== null
        ? Number(s.season_number)
        : meta?.seasonNumber !== undefined && meta?.seasonNumber !== null
          ? Number(meta.seasonNumber)
          : meta?.season_number !== undefined && meta?.season_number !== null
            ? Number(meta.season_number)
            : Number(defaultSeasonNum) || 1;

  const posterPath =
    s.posterPath || s.poster_path || meta?.posterPath || meta?.poster_path || '';
  const airDate =
    s.airDate || s.air_date || meta?.airDate || meta?.air_date || '';
  const rawEpisodes = Array.isArray(s.episodes) ? s.episodes : [];

  const episodes = rawEpisodes.map((rawEp, idx) => {
    const ep = toPlain(rawEp);
    const epNum =
      ep.episodeNumber !== undefined && ep.episodeNumber !== null
        ? Number(ep.episodeNumber)
        : ep.episode_number !== undefined && ep.episode_number !== null
          ? Number(ep.episode_number)
          : idx + 1;
    const stillPath = ep.stillPath || ep.still_path || '';
    const epAirDate = ep.airDate || ep.air_date || '';
    const voteAverage = Number(ep.voteAverage ?? ep.vote_average ?? 0);
    return {
      episodeNumber: epNum,
      episode_number: epNum,
      name: ep.name || `Episode ${epNum}`,
      overview: ep.overview || '',
      airDate: epAirDate,
      air_date: epAirDate,
      runtime: ep.runtime || null,
      stillPath,
      still_path: stillPath,
      stillUrl: img(stillPath, 'w300'),
      voteAverage,
      vote_average: voteAverage,
    };
  });

  return {
    seasonNumber: resolvedNum,
    season_number: resolvedNum,
    name:
      s.name ||
      meta?.name ||
      (resolvedNum === 0 ? 'Specials' : `Season ${resolvedNum}`),
    overview: s.overview || meta?.overview || '',
    airDate,
    air_date: airDate,
    posterPath,
    poster_path: posterPath,
    posterUrl: img(posterPath, 'w342'),
    voteAverage: Number(
      s.voteAverage ?? s.vote_average ?? meta?.voteAverage ?? meta?.vote_average ?? 0,
    ),
    episodeCount:
      episodes.length ||
      Number(s.episodeCount ?? s.episode_count ?? meta?.episodeCount ?? meta?.episode_count ?? 0),
    episodes,
  };
};

/**
 * Cache-Aside TV Season & Episodes Fetcher:
 * - Safely normalizes undefined/NaN seasonNumber to Season 1 (or first available season in DB).
 * - Checks MongoDB `seasonsDetails` first.
 * - If not cached in MongoDB, fetches `/tv/:tmdbId/season/:sNum` from TMDB, stores in MongoDB, and returns shaped season + episodes.
 */
export async function getOrFetchSeason(tmdbIdOrSlug, seasonNumber) {
  const parsedSeason = Number(seasonNumber);
  let sNum =
    Number.isInteger(parsedSeason) && parsedSeason >= 0 ? parsedSeason : null;

  let tmdbId = Number(tmdbIdOrSlug);
  let doc = null;
  if (
    !Number.isInteger(tmdbId) ||
    tmdbId <= 0 ||
    !/^\d+$/.test(String(tmdbIdOrSlug).trim())
  ) {
    doc = await getOrFetchTitle('tv', tmdbIdOrSlug, { details: true });
    tmdbId = doc.tmdbId;
  } else {
    doc = await Title.findOne({ mediaType: 'tv', tmdbId });
    if (!doc || !doc.detailsFetched || !Array.isArray(doc.seasons) || doc.seasons.length === 0) {
      doc = await getOrFetchTitle('tv', tmdbId, { details: true }).catch(() => doc);
    }
  }

  const plainSeasons = (doc?.seasons || []).map(toPlain);
  if (sNum === null) {
    const firstRegular =
      plainSeasons.find((s) => Number(s.seasonNumber ?? s.season_number) > 0) ||
      plainSeasons[0];
    sNum =
      firstRegular &&
      Number.isInteger(Number(firstRegular.seasonNumber ?? firstRegular.season_number))
        ? Number(firstRegular.seasonNumber ?? firstRegular.season_number)
        : 1;
  }

  const seasonMeta = plainSeasons.find(
    (s) => Number(s.seasonNumber ?? s.season_number) === sNum,
  );
  const existing = (doc?.seasonsDetails || [])
    .map(toPlain)
    .find((s) => Number(s.seasonNumber ?? s.season_number) === sNum);

  if (existing && Array.isArray(existing.episodes) && existing.episodes.length > 0) {
    return shapeSeasonDetail(existing, seasonMeta, sNum);
  }

  let data = null;
  try {
    data = await tmdbGet(`/tv/${tmdbId}/season/${sNum}`, {
      language: 'en-US',
    });
  } catch (err) {
    // If requested seasonNumber failed (e.g. Season 0 not on TMDB) and Season 1 exists, fall back to Season 1
    if (sNum !== 1) {
      sNum = 1;
      data = await tmdbGet(`/tv/${tmdbId}/season/1`, {
        language: 'en-US',
      }).catch(() => null);
    }
  }

  if (!data) {
    if (seasonMeta) {
      return shapeSeasonDetail(seasonMeta, seasonMeta, sNum);
    }
    throw ApiError.notFound('Season not found');
  }

  const seasonObj = {
    seasonNumber: data.season_number ?? sNum,
    name: data.name || seasonMeta?.name || `Season ${sNum}`,
    overview: data.overview || seasonMeta?.overview || '',
    airDate: data.air_date || seasonMeta?.airDate || '',
    posterPath: data.poster_path || seasonMeta?.posterPath || '',
    episodes: (data.episodes || []).map((ep, idx) => ({
      episodeNumber: ep.episode_number ?? idx + 1,
      name: ep.name || `Episode ${ep.episode_number ?? idx + 1}`,
      overview: ep.overview || '',
      airDate: ep.air_date || '',
      runtime: ep.runtime || null,
      stillPath: ep.still_path || '',
      voteAverage: ep.vote_average || 0,
    })),
  };

  if (doc) {
    await Title.updateOne(
      { _id: doc._id },
      { $pull: { seasonsDetails: { seasonNumber: sNum } } },
    );
    await Title.updateOne(
      { _id: doc._id },
      { $push: { seasonsDetails: seasonObj } },
    );
  }
  return shapeSeasonDetail(seasonObj, seasonMeta, sNum);
}

// ======================= Shapers (Compatible with both Backend & TMDB Frontend Formats) =======================
export const shapeTitle = (rawDoc) => {
  const t = toPlain(rawDoc);
  const posterUrl = t.customPosterUrl || img(t.posterPath, 'w500');
  const backdropUrl = t.customBackdropUrl || img(t.backdropPath, 'w1280');
  const releaseStr = t.releaseDate
    ? new Date(t.releaseDate).toISOString().slice(0, 10)
    : t.year
      ? `${t.year}-01-01`
      : null;
  const genres =
    t.genres?.length > 0
      ? t.genres.map((g) => {
          const pg = toPlain(g);
          return { id: pg.id, name: pg.name };
        })
      : (t.genreIds || [])
          .map((id) => ({ id, name: genreNames.get(id) }))
          .filter((g) => g.name);

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
    slug: slugifyTitle(
      t.title || t.originalTitle || `${t.mediaType}-${t.tmdbId}`,
    ),
    isUpcoming: Boolean(t.releaseDate && new Date(t.releaseDate).getTime() > Date.now()),
    budget: Number(t.budget) > 0 ? Number(t.budget) : 0,
    revenue:
      t.releaseDate && new Date(t.releaseDate).getTime() > Date.now() && !(t.lockedFields || []).includes('revenue')
        ? 0
        : Number(t.boxOffice?.worldwideCollection || t.revenue) > 0
          ? Number(t.boxOffice?.worldwideCollection || t.revenue)
          : 0,
    financialEstimated: false,
    verdict:
      t.releaseDate && new Date(t.releaseDate).getTime() > Date.now() && !(t.lockedFields || []).includes('boxOffice')
        ? ''
        : Number(t.budget) > 0 &&
          Number(t.boxOffice?.worldwideCollection || t.revenue) > 0
          ? t.boxOffice?.verdict ||
            computeVerdict(
              t.budget,
              t.boxOffice?.worldwideCollection || t.revenue,
            )
          : t.boxOffice?.verdict && t.boxOffice.verdict !== 'TBA'
            ? t.boxOffice.verdict
            : '',
    ottProviders: t.ottProviders || [],
    regions: t.regions || [],
    createdAt: t.createdAt || null,
    updatedAt: t.updatedAt || null,
  };
};

export const shapeDetail = (rawDoc) => {
  const t = toPlain(rawDoc);
  const base = shapeTitle(t);
  const videos = (t.videos || [])
    .map((rawV) => {
      const v = toPlain(rawV);
      if (!v || !v.key) return null;
      return {
        id: v.id || v.key,
        key: v.key,
        name: v.name || v.type || 'Video',
        site: v.site || 'YouTube',
        type: v.type || 'Clip',
        official: v.official !== false,
        publishedAt: v.publishedAt || null,
        url: `https://www.youtube.com/watch?v=${v.key}`,
        embedUrl: `https://www.youtube.com/embed/${v.key}`,
        thumbnailUrl: `https://img.youtube.com/vi/${v.key}/hqdefault.jpg`,
      };
    })
    .filter(Boolean);

  const songs = (t.songs || [])
    .map((rawS, idx) => {
      const s = toPlain(rawS);
      if (!s) return null;
      return {
        id: s.id || s.youtubeKey || `song-${idx}`,
        title: s.title || `Track ${idx + 1}`,
        youtubeKey: s.youtubeKey,
        artist: s.artist || '',
        composer: s.composer || (t.musicDirectors || [])[0] || '',
        lyricist: s.lyricist || '',
        duration: s.duration || '',
        language: s.language || t.originalLanguage || 'en',
        isOfficial: s.isOfficial !== false,
        url: s.youtubeKey
          ? `https://www.youtube.com/watch?v=${s.youtubeKey}`
          : null,
        embedUrl: s.youtubeKey
          ? `https://www.youtube.com/embed/${s.youtubeKey}`
          : null,
        thumbnailUrl: s.youtubeKey
          ? `https://img.youtube.com/vi/${s.youtubeKey}/hqdefault.jpg`
          : null,
      };
    })
    .filter(Boolean);

  const cast = (t.cast || []).map((rawC) => {
    const c = toPlain(rawC);
    return {
      id: c.id,
      name: c.name,
      gender: c.gender || 0,
      character: c.character,
      profilePath: c.profilePath,
      profile_path: c.profilePath,
      profileUrl: img(c.profilePath, 'h632'),
      photoUrl: img(c.profilePath, 'h632'),
    };
  });

  const crew = (t.crew || []).map((rawC) => {
    const c = toPlain(rawC);
    return {
      id: c.id,
      name: c.name,
      gender: c.gender || 0,
      job: c.job,
      department: c.department,
      profilePath: c.profilePath,
      profile_path: c.profilePath,
      profileUrl: img(c.profilePath, 'h632'),
      photoUrl: img(c.profilePath, 'h632'),
    };
  });

  const isUnreleased = Boolean(
    t.releaseDate &&
      new Date(t.releaseDate).getTime() > Date.now() &&
      !(t.lockedFields || []).includes('revenue') &&
      !(t.lockedFields || []).includes('boxOffice'),
  );
  const budget = Number(t.budget) > 0 ? Number(t.budget) : 0;
  const rawBoxOffice = toPlain(t.boxOffice);
  const revenue = isUnreleased
    ? 0
    : Number(rawBoxOffice?.worldwideCollection || t.revenue) > 0
      ? Number(rawBoxOffice?.worldwideCollection || t.revenue)
      : 0;
  const profit = revenue > 0 && budget > 0 ? revenue - budget : 0;
  const roiPercent =
    budget > 0 && revenue > 0
      ? Math.round(((revenue - budget) / budget) * 100)
      : null;

  const boxOffice = {
    budget,
    revenue,
    budgetFormatted:
      rawBoxOffice?.budgetFormatted ||
      (budget > 0 ? `$${budget.toLocaleString()}` : ''),
    domesticCollection: rawBoxOffice?.domesticCollection || 0,
    internationalCollection: rawBoxOffice?.internationalCollection || 0,
    worldwideCollection: revenue,
    indiaNetCollection: rawBoxOffice?.indiaNetCollection || 0,
    indiaGrossCollection: rawBoxOffice?.indiaGrossCollection || 0,
    openingWeekend: rawBoxOffice?.openingWeekend || 0,
    openingDay: rawBoxOffice?.openingDay || 0,
    currency: rawBoxOffice?.currency || 'USD',
    verdict: isUnreleased
      ? ''
      : budget > 0 && revenue > 0
        ? computeVerdict(budget, revenue, rawBoxOffice?.verdict)
        : rawBoxOffice?.verdict && rawBoxOffice.verdict !== 'TBA' && revenue > 0
          ? rawBoxOffice.verdict
          : '',
    profit,
    roiPercent,
    notes: rawBoxOffice?.notes || '',
  };

  const mapProviderLogos = (arr = []) =>
    arr.map((rawP) => {
      const p = toPlain(rawP);
      return {
        id: p.id,
        name: p.name,
        logoPath: p.logoPath,
        logoUrl: img(p.logoPath, 'w92'),
      };
    });

  // Unwrap & sort TV / Web Series seasons so Season 1..N appear first and Season 0 (Specials) last
  let shapedSeasons = (t.seasons || [])
    .map((rawS, idx) => {
      const s = toPlain(rawS);
      const sNum =
        s.seasonNumber !== undefined && s.seasonNumber !== null
          ? Number(s.seasonNumber)
          : s.season_number !== undefined && s.season_number !== null
            ? Number(s.season_number)
            : idx + 1;
      const epCount = Number(s.episodeCount ?? s.episode_count ?? 0);
      const posterPath = s.posterPath ?? s.poster_path ?? null;
      const airDate = s.airDate ?? s.air_date ?? '';
      const voteAvg = Number(s.voteAverage ?? s.vote_average ?? 0);
      return {
        seasonNumber: sNum,
        season_number: sNum,
        name: s.name || (sNum === 0 ? 'Specials' : `Season ${sNum}`),
        episodeCount: epCount,
        episode_count: epCount,
        airDate,
        air_date: airDate,
        posterPath,
        poster_path: posterPath,
        posterUrl: img(posterPath || t.posterPath, 'w342'),
        overview: s.overview || '',
        voteAverage: voteAvg,
        vote_average: voteAvg,
      };
    })
    .sort((a, b) => {
      if (a.seasonNumber === 0 && b.seasonNumber !== 0) return 1;
      if (b.seasonNumber === 0 && a.seasonNumber !== 0) return -1;
      return a.seasonNumber - b.seasonNumber;
    });

  const totalSeasonCount =
    Number(t.numberOfSeasons) ||
    shapedSeasons.filter((s) => s.seasonNumber > 0).length ||
    shapedSeasons.length ||
    (t.mediaType === 'tv' ? 1 : 0);

  if (t.mediaType === 'tv' && shapedSeasons.length === 0 && totalSeasonCount > 0) {
    shapedSeasons = Array.from({ length: totalSeasonCount }, (_, i) => ({
      seasonNumber: i + 1,
      season_number: i + 1,
      name: `Season ${i + 1}`,
      episodeCount: Number(t.numberOfEpisodes) || 0,
      episode_count: Number(t.numberOfEpisodes) || 0,
      airDate: '',
      air_date: '',
      posterPath: t.posterPath || null,
      poster_path: t.posterPath || null,
      posterUrl: img(t.posterPath, 'w342'),
      overview: t.overview || '',
      voteAverage: Number(t.voteAverage) || 0,
      vote_average: Number(t.voteAverage) || 0,
    }));
  }

  const shapedSeasonsDetails = (t.seasonsDetails || []).map((sd) => {
    const plainSd = toPlain(sd);
    const meta = shapedSeasons.find(
      (s) => s.seasonNumber === Number(plainSd.seasonNumber ?? plainSd.season_number),
    );
    return shapeSeasonDetail(plainSd, meta, plainSd.seasonNumber ?? 1);
  });

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
    productionCompanies: (t.productionCompanies || []).map((rawP) => {
      const p = toPlain(rawP);
      return {
        id: p.id,
        name: p.name,
        logoPath: p.logoPath,
        country: p.country,
        logoUrl: img(p.logoPath, 'w185'),
      };
    }),
    networks: (t.networks || []).map((rawN) => {
      const n = toPlain(rawN);
      return {
        id: n.id,
        name: n.name,
        logoPath: n.logoPath,
        logoUrl: img(n.logoPath, 'w185'),
      };
    }),
    budget,
    revenue,
    boxOffice,
    numberOfSeasons: totalSeasonCount,
    number_of_seasons: totalSeasonCount,
    numberOfEpisodes: t.numberOfEpisodes || 0,
    number_of_episodes: t.numberOfEpisodes || 0,
    seasons: shapedSeasons,
    seasonsDetails: shapedSeasonsDetails,
    directors: t.directors || [],
    writers: t.writers || [],
    producers: t.producers || [],
    musicDirectors: t.musicDirectors || [],
    cast,
    crew,
    credits: {
      cast,
      crew: [
        ...(t.directors || []).map((name) => ({
          name,
          job: 'Director',
          department: 'Directing',
        })),
        ...(t.musicDirectors || []).map((name) => ({
          name,
          job: 'Original Music Composer',
          department: 'Sound',
        })),
        ...crew,
      ],
    },
    trailerKey: t.trailerKey || videos[0]?.key || null,
    trailerUrl: t.trailerKey
      ? `https://www.youtube.com/watch?v=${t.trailerKey}`
      : null,
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
    tmdbReviews: (t.tmdbReviews || []).map((rawR) => {
      const r = toPlain(rawR);
      return {
        id: r.id,
        author: r.author,
        authorAvatar: r.authorAvatar,
        rating: r.rating,
        content: r.content,
        url: r.url,
        createdAt: r.createdAt,
        avatarUrl: r.authorAvatar
          ? r.authorAvatar.startsWith('/http')
            ? r.authorAvatar.slice(1)
            : img(r.authorAvatar, 'w185')
          : null,
      };
    }),
    lockedFields: t.lockedFields || [],
    hasFullDetails: !!t.detailsFetched,
  };
};

export async function titlesByPairs(pairs) {
  if (!pairs.length) return new Map();
  const docs = await Title.find({
    $or: pairs.map((p) => ({ mediaType: p.type, tmdbId: p.tmdbId })),
  });
  return new Map(
    docs.map((d) => [`${d.mediaType}:${d.tmdbId}`, shapeTitle(d)]),
  );
}

/** Recalculates both User Community rating and Critic rating on a Title. */
export async function recalcSiteRating(type, tmdbId) {
  const [userAgg, criticAgg] = await Promise.all([
    Review.aggregate([
      {
        $match: {
          type,
          tmdbId,
          reviewType: { $ne: 'critic' },
          isHidden: { $ne: true },
        },
      },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
    Review.aggregate([
      {
        $match: { type, tmdbId, reviewType: 'critic', isHidden: { $ne: true } },
      },
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
export const buildFilter = (q, { personContext = null } = {}) => {
  const f = {};
  const rawType = String(q.type || '').toLowerCase().trim();
  if (
    rawType === 'webseries' ||
    rawType === 'web-series' ||
    q.subType === 'webseries' ||
    q.isWebSeries === 'true'
  ) {
    f.mediaType = 'tv';
    f.$or = [
      { isWebSeries: true },
      { subType: 'webseries' },
      { ottProviders: { $exists: true, $ne: [] } },
    ];
  } else if (['tv', 'tv-show', 'tv-shows', 'tv-series'].includes(rawType)) {
    f.mediaType = 'tv';
    if (!q.q) {
      f.isWebSeries = { $ne: true };
      f.subType = { $ne: 'webseries' };
    }
  } else if (['movie', 'movies'].includes(rawType)) {
    f.mediaType = 'movie';
  }

  // Support both numeric Genre IDs and human-readable Genre slugs (e.g. ?genre=thriller or ?genre=sci-fi)
  const genreParam = q.genre ?? q.with_genres ?? '';
  const genres = resolveBackendGenreIds(genreParam, f.mediaType || 'movie');
  if (genres.length)
    f.genreIds = q.genreMode === 'all' ? { $all: genres } : { $in: genres };

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
      f.$and = [
        ...(f.$and || []),
        { $or: [{ regions: ind }, { originalLanguage: { $in: langs } }] },
      ];
    } else {
      f.regions = ind;
    }
  }

  if (q.ott || q.with_watch_providers) {
    const ottList = toList(q.ott || q.with_watch_providers);
    const mappedKeys = ottList.map((k) => resolveBackendOttKey(k)).filter(Boolean);
    if (mappedKeys.length) {
      f.ottProviders = { $in: mappedKeys };
    }
  }

  const rating = compact({
    $gte: toNum(q.minRating ?? q['vote_average.gte']),
    $lte: toNum(q.maxRating),
  });
  if (Object.keys(rating).length) f.voteAverage = rating;

  if (toInt(q.minVotes ?? q['vote_count.gte'])) {
    f.voteCount = { $gte: toInt(q.minVotes ?? q['vote_count.gte']) };
  }

  const runtime = compact({
    $gte: toInt(q.minRuntime),
    $lte: toInt(q.maxRuntime),
  });
  if (Object.keys(runtime).length) f.runtime = runtime;

  if (q.q) {
    const cleanQ = String(q.q).trim().slice(0, 100);
    if (cleanQ) {
      const escaped = cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const personMeta = personContext?.personMeta;
      const creditPairs = personContext?.creditPairs || [];
      const isPersonPrimary = Boolean(
        personContext?.isPersonPrimary && personMeta,
      );

      if (isPersonPrimary) {
        const safePersonName = String(personMeta.name || cleanQ).replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        const exactNameRegex = new RegExp(`^${safePersonName}$`, 'i');
        const personOr = [];
        if (creditPairs.length > 0) {
          personOr.push(...creditPairs);
          if (personMeta.id) {
            personOr.push({ 'cast.id': personMeta.id }, { 'crew.id': personMeta.id });
          }
          personOr.push(
            { isCustom: true, 'cast.name': exactNameRegex },
            { isCustom: true, directors: exactNameRegex },
          );
        } else {
          if (personMeta.id) {
            personOr.push({ 'cast.id': personMeta.id }, { 'crew.id': personMeta.id });
          }
          personOr.push(
            { 'cast.name': exactNameRegex },
            { 'crew.name': exactNameRegex },
            { directors: exactNameRegex },
            { writers: exactNameRegex },
            { producers: exactNameRegex },
            { musicDirectors: exactNameRegex },
          );
        }
        f.$and = [...(f.$and || []), { $or: personOr }];
      } else {
        const searchOr = [
          { title: { $regex: escaped, $options: 'i' } },
          { originalTitle: { $regex: escaped, $options: 'i' } },
          { directors: { $regex: escaped, $options: 'i' } },
          { writers: { $regex: escaped, $options: 'i' } },
          { producers: { $regex: escaped, $options: 'i' } },
          { musicDirectors: { $regex: escaped, $options: 'i' } },
          { 'cast.name': { $regex: escaped, $options: 'i' } },
          { 'crew.name': { $regex: escaped, $options: 'i' } },
        ];
        if (personMeta?.id) {
          searchOr.push(
            { 'cast.id': personMeta.id },
            { 'crew.id': personMeta.id },
          );
        }
        if (creditPairs.length > 0) {
          searchOr.push(...creditPairs);
        }
        f.$and = [...(f.$and || []), { $or: searchOr }];
      }
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
  'tmdbId mediaType subType isWebSeries isCustom title originalTitle overview posterPath backdropPath customPosterUrl customBackdropUrl releaseDate year genreIds genres originalLanguage voteAverage voteCount popularity siteRating siteReviewCount criticRating criticReviewCount budget revenue boxOffice ottProviders regions createdAt updatedAt';

/**
 * Fetches from TMDB when a frontend query is NOT present in MongoDB, stores in MongoDB, and returns.
 */
async function fetchFromTmdbAndStore(
  query = {},
  listName = null,
  { skipTitleSearch = false } = {},
) {
  const qTypeNorm = String(query.type || '').toLowerCase().trim();
  const isWebQuery = qTypeNorm === 'webseries' || qTypeNorm === 'web-series';
  const rawType =
    isWebQuery || ['tv', 'tv-show', 'tv-shows', 'tv-series'].includes(qTypeNorm)
      ? 'tv'
      : 'movie';
  const page = Math.max(1, toInt(query.page) || 1);

  try {
    // 1. Search query fallback
    if (query.q && String(query.q).trim().length >= 2) {
      if (skipTitleSearch) return;
      const q = String(query.q).trim();
      if (['movie', 'tv'].includes(query.type)) {
        const data = await tmdbGet(`/search/${rawType}`, {
          query: q,
          page,
          include_adult: false,
        });
        if (data?.results?.length) {
          await saveListings(data.results, rawType, {
            isWebSeries: query.type === 'webseries',
          });
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
      if (listName === 'upcoming') {
        const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        const dateKey = rawType === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte';
        const [upData, discFuture] = await Promise.all([
          tmdbGet(rawType === 'tv' ? '/tv/on_the_air' : '/movie/upcoming', { page, language: 'en-US' }).catch(() => null),
          tmdbGet(`/discover/${rawType}`, {
            page,
            sort_by: 'popularity.desc',
            [dateKey]: tomorrowIso,
            include_adult: false,
            language: 'en-US',
          }).catch(() => null),
        ]);
        const combinedResults = [...(discFuture?.results || []), ...(upData?.results || [])];
        const futureOnly = combinedResults.filter((r) => {
          const dStr = r?.release_date || r?.first_air_date;
          if (!dStr) return false;
          const ms = new Date(dStr).getTime();
          return Number.isFinite(ms) && ms > Date.now();
        });
        if (futureOnly.length) {
          await saveListings(futureOnly, rawType, { listTag: 'upcoming', isWebSeries: isWebQuery });
        }
        return;
      }
      const mapCategory = {
        trending: `/trending/${rawType}/week`,
        popular: `/${rawType}/popular`,
        'top-rated': `/${rawType}/top_rated`,
        top_rated: `/${rawType}/top_rated`,
        'now-playing':
          rawType === 'tv' ? '/tv/on_the_air' : '/movie/now_playing',
        now_playing: rawType === 'tv' ? '/tv/on_the_air' : '/movie/now_playing',
      };
      const endpoint = mapCategory[listName];
      if (endpoint) {
        const data = await tmdbGet(endpoint, { page, language: 'en-US' });
        if (data?.results?.length) {
          await saveListings(data.results, rawType, { listTag: listName, isWebSeries: isWebQuery });
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
    if (genreParam) {
      const resolvedIds = resolveBackendGenreIds(genreParam, rawType);
      params.with_genres = resolvedIds.length ? resolvedIds.join('|') : String(genreParam);
    }

    const year = toInt(
      query.year ?? query.primary_release_year ?? query.first_air_date_year,
    );
    if (year) {
      params[
        rawType === 'tv' ? 'first_air_date_year' : 'primary_release_year'
      ] = year;
    }

    const ind = query.industry ? String(query.industry).toLowerCase() : null;
    const lang =
      query.language ??
      query.lang ??
      query.with_original_language ??
      (ind && INDUSTRIES[ind]?.[0]);
    if (lang && lang !== 'en-US') {
      params.with_original_language = String(lang).split(',')[0];
    }

    const ottKey = query.ott ? resolveBackendOttKey(query.ott) : null;
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
export async function findTitles(
  query = {},
  { extra = {}, sort, listName = null, allowTmdbFallback = true, skipCount = false } = {},
) {
  const page = Math.max(1, toInt(query.page) || 1);
  const limit = Math.min(50, Math.max(1, toInt(query.limit) || 20));
  const skip = (page - 1) * limit;
  if (skip > 50_000)
    throw ApiError.badRequest('Page too deep: narrow your filters instead');

  // Random pick support (for "I'm Feeling Lucky")
  if (query.sort === 'random') {
    const base = buildFilter(query);
    const sample = await Title.aggregate([
      { $match: { adult: { $ne: true }, ...base } },
      { $sample: { size: limit } },
    ]);
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

  // If the user is searching `query.q`, check whether `query.q` is an Actor / Actress / Director name
  let personContext = null;
  const cleanSearch = query.q ? String(query.q).trim() : '';

  if (cleanSearch.length >= 2 && allowTmdbFallback) {
    const synced = await syncPersonCreditsToMongo({
      name: cleanSearch,
      fromSearch: true,
    });
    if (synced && synced.personMeta && synced.creditPairs?.length > 0) {
      const normQ = cleanSearch
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
      const normName = String(synced.personMeta.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
      const exactOrCloseName =
        normName === normQ ||
        normName.replace(/\s+/g, '') === normQ.replace(/\s+/g, '') ||
        (normQ.split(/\s+/).length >= 2 &&
          (normName.includes(normQ) || normQ.includes(normName)));

      // Check if there is a mainstream movie/series with the exact same 1-word title and huge vote count
      const escapedExact = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exactTitleBlockbuster =
        normQ.split(/\s+/).length === 1
          ? await Title.findOne({
              $or: [
                { title: { $regex: `^${escapedExact}$`, $options: 'i' } },
                {
                  originalTitle: { $regex: `^${escapedExact}$`, $options: 'i' },
                },
              ],
              voteCount: { $gte: 800 },
            })
              .select('_id popularity voteCount')
              .lean()
          : null;

      const isPersonPrimary = Boolean(
        exactOrCloseName &&
        (!exactTitleBlockbuster || (synced.personMeta.popularity || 0) >= 8),
      );

      personContext = {
        personMeta: synced.personMeta,
        creditPairs: synced.creditPairs,
        isPersonPrimary,
      };
    } else {
      // Offline / MongoDB-only fallback: check if cleanSearch matches an existing cast.name or crew.name or directors in MongoDB
      const escapedSearch = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exactRegex = new RegExp(`^${escapedSearch}$`, 'i');
      const existingPersonDoc = await Title.findOne({
        $or: [
          { 'cast.name': exactRegex },
          { 'crew.name': exactRegex },
          { directors: exactRegex },
        ],
      })
        .select('cast crew directors')
        .lean();

      if (existingPersonDoc) {
        const matchedCast = (existingPersonDoc.cast || []).find((c) =>
          exactRegex.test(c.name || ''),
        );
        const matchedCrew = (existingPersonDoc.crew || []).find((c) =>
          exactRegex.test(c.name || ''),
        );
        personContext = {
          personMeta: {
            id: matchedCast?.id || matchedCrew?.id || null,
            name: matchedCast?.name || matchedCrew?.name || cleanSearch,
            profileUrl: img(
              matchedCast?.profilePath || matchedCrew?.profilePath,
              'w500',
            ),
            knownForDepartment: matchedCast ? 'Acting' : 'Directing',
          },
          creditPairs: [],
          isPersonPrimary: true,
        };
      }
    }
  }

  const effectiveListKey = String(listName || query.list || '')
    .toLowerCase()
    .replace('_', '-')
    .trim();
  const listSpec =
    effectiveListKey && LISTS[effectiveListKey]
      ? LISTS[effectiveListKey]()
      : null;
  const effectiveExtra =
    extra && Object.keys(extra).length > 0
      ? extra
      : listSpec?.extra || {};
  const effectiveSort = sort || listSpec?.sort;

  const runMongoQuery = async (ctx = personContext) => {
    const base = buildFilter(query, { personContext: ctx });
    let order =
      effectiveSort || SORTS[query.sort] || SORTS[query.sort_by] || SORTS.popularity;
    if (
      ['newest', 'oldest', 'release_date.desc'].includes(
        query.sort || query.sort_by,
      )
    ) {
      base.releaseDate = { $ne: null };
    }
    if (query.order && order) {
      order = Object.fromEntries(
        Object.keys(order).map((k) => [k, query.order === 'asc' ? 1 : -1]),
      );
    }
    const filter = { $and: [{ adult: { $ne: true } }, base, effectiveExtra] };
    const [docs, countedTotal] = await Promise.all([
      Title.find(filter)
        .select(LIST_FIELDS)
        .sort(order)
        .skip(skip)
        .limit(limit)
        .lean(),
      skipCount ? Promise.resolve(null) : Title.countDocuments(filter, { limit: 100_000 }),
    ]);
    const total = countedTotal ?? docs.length;
    return { docs, total };
  };

  let { docs, total } = await runMongoQuery(personContext);
  let source = personContext?.creditPairs?.length
    ? 'tmdb_person_credits_cached'
    : 'mongodb';

  // If requested data is not in DB (or too few results on page 1 for non-person search), fetch from TMDB -> store in DB -> serve!
  const needsFallback =
    allowTmdbFallback &&
    !personContext?.isPersonPrimary &&
    (docs.length === 0 || (query.q && page === 1 && docs.length < 5));

  if (needsFallback) {
    await fetchFromTmdbAndStore(query, effectiveListKey || listName);
    const retry = await runMongoQuery(personContext);
    docs = retry.docs;
    total = retry.total;
    source = 'tmdb_cached_to_mongodb';
  }

  const shaped = docs.map(shapeTitle);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    items: shaped,
    results: shaped, // TMDB API response compatibility
    matchedPerson: personContext?.personMeta || null,
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
    extra: {
      $or: [
        { listTags: 'trending' },
        {
          releaseDate: { $gte: daysAgo(730), $lte: new Date() },
          voteCount: { $gte: 5 },
        },
      ],
    },
    sort: SORTS.popularity,
  }),
  popular: () => ({ extra: {}, sort: SORTS.popularity }),
  'top-rated': () => ({
    extra: { voteCount: { $gte: 200 } },
    sort: SORTS.rating,
  }),
  top_rated: () => ({
    extra: { voteCount: { $gte: 200 } },
    sort: SORTS.rating,
  }),
  'now-playing': () => ({
    extra: {
      $or: [
        { listTags: 'now-playing' },
        { releaseDate: { $gte: daysAgo(60), $lte: new Date() } },
      ],
    },
    sort: SORTS.popularity,
  }),
  now_playing: () => ({
    extra: {
      $or: [
        { listTags: 'now-playing' },
        { releaseDate: { $gte: daysAgo(60), $lte: new Date() } },
      ],
    },
    sort: SORTS.popularity,
  }),
  upcoming: () => ({
    extra: {
      releaseDate: { $gt: new Date() },
    },
    sort: { popularity: -1, releaseDate: 1 },
  }),
  'community-top': () => ({
    extra: { siteReviewCount: { $gte: 1 } },
    sort: SORTS.community,
  }),
  'box-office': () => ({ extra: { revenue: { $gt: 0 } }, sort: SORTS.revenue }),
  webseries: () => ({
    extra: {
      mediaType: 'tv',
      $or: [{ isWebSeries: true }, { subType: 'webseries' }],
    },
    sort: SORTS.popularity,
  }),
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
