import env from '../config/env.js';
import { REGIONS } from '../config/regions.js';
import CrawlJob from '../models/CrawlJob.js';
import Genre from '../models/Genre.js';
import Title from '../models/Title.js';
import ApiError from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { tmdbGet } from './tmdb.client.js';
import { fromDetails, saveListings, syncGenres } from './title.service.js';

export const OTT_CRAWL_TARGETS = [
  { key: 'netflix', name: 'Netflix', providerIds: '8', watchRegion: 'IN' },
  { key: 'prime', name: 'Amazon Prime Video', providerIds: '119|9', watchRegion: 'IN' },
  { key: 'hotstar', name: 'Disney+ Hotstar', providerIds: '122|337', watchRegion: 'IN' },
  { key: 'jiocinema', name: 'JioCinema', providerIds: '220', watchRegion: 'IN' },
  { key: 'sonyliv', name: 'SonyLIV', providerIds: '237', watchRegion: 'IN' },
  { key: 'zee5', name: 'ZEE5', providerIds: '232', watchRegion: 'IN' },
  { key: 'apple', name: 'Apple TV+', providerIds: '350', watchRegion: 'US' },
  { key: 'hulu', name: 'Hulu', providerIds: '15', watchRegion: 'US' },
  { key: 'max', name: 'Max (HBO)', providerIds: '1899|384', watchRegion: 'US' },
  { key: 'crunchyroll', name: 'Crunchyroll', providerIds: '283', watchRegion: 'US' },
  { key: 'mxplayer', name: 'MX Player', providerIds: '515', watchRegion: 'IN' },
];

class StopSignal extends Error {}
class AllQuotasFullSignal extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE_SIZE = 20;

let running = false;
let stopRequested = false;

let quotas = {
  total: Number(env.crawler?.maxTitles) || 100_000,
  movie: Number(env.crawler?.movieQuota) || 50_000,
  tv: Number(env.crawler?.tvQuota) || 25_000,
  webseries: Number(env.crawler?.webSeriesQuota) || 25_000,
  maxPerYearMovie: Number(env.crawler?.maxPerYearMovie) || 1200,
  maxPerYearTv: Number(env.crawler?.maxPerYearTv) || 700,
  maxPerYearWebSeries: Number(env.crawler?.maxPerYearWebSeries) || 700,
};

export const isCrawling = () => running;
export const requestStop = () => {
  if (running) stopRequested = true;
};

export const setTargetCap = (input) => {
  if (typeof input === 'object' && input !== null) {
    if (Number(input.movieQuota) >= 500) quotas.movie = Number(input.movieQuota);
    if (Number(input.tvQuota) >= 500) quotas.tv = Number(input.tvQuota);
    if (Number(input.webSeriesQuota) >= 500) quotas.webseries = Number(input.webSeriesQuota);
    if (Number(input.maxPerYearMovie) >= 100) quotas.maxPerYearMovie = Number(input.maxPerYearMovie);
    if (Number(input.maxPerYearTv) >= 100) quotas.maxPerYearTv = Number(input.maxPerYearTv);
    if (Number(input.maxPerYearWebSeries) >= 100) quotas.maxPerYearWebSeries = Number(input.maxPerYearWebSeries);
    quotas.total =
      Number(input.targetCap) >= 1500
        ? Number(input.targetCap)
        : quotas.movie + quotas.tv + quotas.webseries;
  } else if (Number.isInteger(Number(input)) && Number(input) >= 1500) {
    const total = Number(input);
    quotas.total = total;
    quotas.movie = Math.round(total * 0.5);
    quotas.tv = Math.round(total * 0.25);
    quotas.webseries = total - quotas.movie - quotas.tv;
  }
  return quotas.total;
};

export const getQuotas = () => ({ ...quotas });

/**
 * Pure read-only count helper (safe to call from getCrawlerStatus() even when crawler is stopped).
 * Never throws StopSignal here!
 */
async function getCategoryCounts() {
  const [movies, webSeries, totalTv] = await Promise.all([
    Title.countDocuments({ mediaType: 'movie' }),
    Title.countDocuments({ mediaType: 'tv', $or: [{ isWebSeries: true }, { subType: 'webseries' }] }),
    Title.countDocuments({ mediaType: 'tv' }),
  ]);
  const tv = Math.max(0, totalTv - webSeries);
  const total = movies + totalTv;
  return {
    movie: movies,
    tv,
    webseries: webSeries,
    totalTv,
    total,
  };
}

/** Checks stopRequested and whether a specific category (`movie` | `tv` | `webseries`) still has room under its quota. */
async function hasCategoryRoom(category) {
  if (stopRequested) throw new StopSignal('Stopped by superadmin');
  const counts = await getCategoryCounts();
  if (counts.total >= quotas.total) {
    throw new AllQuotasFullSignal(
      `Reached total database cap of ${quotas.total.toLocaleString()} titles (Movies: ${counts.movie.toLocaleString()}, TV: ${counts.tv.toLocaleString()}, Web Series: ${counts.webseries.toLocaleString()})`,
    );
  }
  if (category === 'movie') return counts.movie < quotas.movie;
  if (category === 'webseries') return counts.webseries < quotas.webseries;
  if (category === 'tv') return counts.tv < quotas.tv;
  return true;
}

/** Polite TMDB request with automatic retry when all keys are cooling down. */
async function fetchPage(path, params) {
  for (;;) {
    if (stopRequested) throw new StopSignal('Stopped by superadmin');
    try {
      await sleep(env.crawler?.delayMs || 60);
      return await tmdbGet(path, params);
    } catch (err) {
      if (err.statusCode !== 503) throw err;
      logger.warn('Crawler: no usable TMDB key, waiting 60 seconds...');
      await sleep(60_000);
    }
  }
}

/** Saves listings and applies region / OTT / webseries tags */
async function saveAndTag(results, type, tags = {}) {
  if (!results?.length) return 0;
  const saved = await saveListings(results, type, tags);
  const ids = results.map((r) => r.id).filter(Boolean);
  if (ids.length && (tags.regionKey || tags.ottKey || tags.listTag || tags.isWebSeries)) {
    const update = {};
    const addToSet = {};
    if (tags.regionKey) addToSet.regions = tags.regionKey;
    if (tags.ottKey) addToSet.ottProviders = tags.ottKey;
    if (tags.listTag) addToSet.listTags = tags.listTag;
    if (Object.keys(addToSet).length) update.$addToSet = addToSet;
    if (tags.isWebSeries && type === 'tv') {
      update.$set = { isWebSeries: true, subType: 'webseries' };
    }
    if (Object.keys(update).length) {
      await Title.updateMany({ mediaType: type, tmdbId: { $in: ids } }, update);
    }
  }
  return saved;
}

/**
 * Phase 1: Crawl & Rotate Trending, Popular, Top Rated, Now Playing, Upcoming
 */
async function crawlPopularAndTrending(restart = false, { ignoreQuotaCap = false } = {}) {
  let job = await CrawlJob.findOne({ name: 'popular_trending' });
  if (!job || restart) {
    job = await CrawlJob.findOneAndUpdate(
      { name: 'popular_trending' },
      { status: 'running', currentStep: null, titlesSaved: 0, targetCap: quotas.total, startedAt: new Date(), finishedAt: null, lastError: null },
      { upsert: true, new: true },
    );
  } else if (job.status === 'done' && !ignoreQuotaCap) {
    return;
  } else {
    await CrawlJob.updateOne({ name: 'popular_trending' }, { status: 'running', targetCap: quotas.total, lastError: null });
  }

  if (restart || ignoreQuotaCap) {
    await Title.updateMany(
      {
        listTags: { $in: ['trending', 'now-playing', 'upcoming'] },
        lockedFields: { $ne: 'listTags' },
      },
      { $pull: { listTags: { $in: ['trending', 'now-playing', 'upcoming'] } } },
    );
    logger.info('Crawler: cleared old trending/now-playing/upcoming tags before fresh rotation');
  }

  const endpoints = [
    { step: 'trending:movie:week', path: '/trending/movie/week', type: 'movie', category: 'movie', listTag: 'trending', maxPages: 15 },
    { step: 'trending:tv:week', path: '/trending/tv/week', type: 'tv', category: 'webseries', isWebSeries: true, listTag: 'trending', maxPages: 15 },
    { step: 'popular:movie', path: '/movie/popular', type: 'movie', category: 'movie', listTag: 'popular', maxPages: 20 },
    { step: 'popular:tv', path: '/tv/popular', type: 'tv', category: 'tv', listTag: 'popular', maxPages: 20 },
    { step: 'top_rated:movie', path: '/movie/top_rated', type: 'movie', category: 'movie', listTag: 'top-rated', maxPages: 15 },
    { step: 'top_rated:tv', path: '/tv/top_rated', type: 'tv', category: 'tv', listTag: 'top-rated', maxPages: 15 },
    { step: 'now_playing:movie', path: '/movie/now_playing', type: 'movie', category: 'movie', listTag: 'now-playing', maxPages: 15 },
    { step: 'upcoming:movie', path: '/movie/upcoming', type: 'movie', category: 'movie', listTag: 'upcoming', maxPages: 15 },
    { step: 'on_the_air:tv', path: '/tv/on_the_air', type: 'tv', category: 'tv', listTag: 'now-playing', maxPages: 15 },
  ];

  let startIdx = 0;
  if (!restart && !ignoreQuotaCap && job.currentStep) {
    const idx = endpoints.findIndex((e) => e.step === job.currentStep);
    if (idx >= 0) startIdx = idx + 1;
  }

  for (const ep of endpoints.slice(startIdx)) {
    if (stopRequested) throw new StopSignal('Stopped by superadmin');
    if (!ignoreQuotaCap && !(await hasCategoryRoom(ep.category))) continue;
    let savedInStep = 0;
    for (let page = 1; page <= ep.maxPages; page++) {
      if (stopRequested) throw new StopSignal('Stopped by superadmin');
      if (!ignoreQuotaCap && !(await hasCategoryRoom(ep.category))) break;
      const data = await fetchPage(ep.path, { page, language: 'en-US' });
      if (!data?.results?.length) break;
      savedInStep += await saveAndTag(data.results, ep.type, {
        listTag: ep.listTag,
        isWebSeries: !!ep.isWebSeries,
      });
      if (page >= (data.total_pages || 1)) break;
    }
    await CrawlJob.updateOne(
      { name: 'popular_trending' },
      { currentStep: ep.step, $inc: { titlesSaved: savedInStep }, lastActivityAt: new Date() },
    );
    logger.info(`Crawler [Popular/Trending]: ${ep.step} processed (${savedInStep} items)`);
  }

  await CrawlJob.updateOne({ name: 'popular_trending' }, { status: 'done', finishedAt: new Date() });
}

/** Phase 2: Crawl Top OTT Catalogs (Web Series + OTT Movies across Netflix, Prime, Hotstar, JioCinema, SonyLIV, ZEE5, Apple TV+, etc.) */
async function crawlOttProviders(restart = false) {
  let job = await CrawlJob.findOne({ name: 'ott' });
  if (!job || restart) {
    job = await CrawlJob.findOneAndUpdate(
      { name: 'ott' },
      { status: 'running', currentStep: null, titlesSaved: 0, targetCap: quotas.total, startedAt: new Date(), finishedAt: null, lastError: null },
      { upsert: true, new: true },
    );
  } else if (job.status === 'done') {
    return;
  } else {
    await CrawlJob.updateOne({ name: 'ott' }, { status: 'running', targetCap: quotas.total, lastError: null });
  }

  const maxPagesPerOtt = 15;
  const steps = [];
  for (const ott of OTT_CRAWL_TARGETS) {
    steps.push({ step: `ott:${ott.key}:webseries`, ott, type: 'tv', category: 'webseries', isWebSeries: true });
    steps.push({ step: `ott:${ott.key}:movie`, ott, type: 'movie', category: 'movie', isWebSeries: false });
  }

  let startIdx = 0;
  if (job.currentStep) {
    const idx = steps.findIndex((s) => s.step === job.currentStep);
    if (idx >= 0) startIdx = idx + 1;
  }

  for (const s of steps.slice(startIdx)) {
    if (!(await hasCategoryRoom(s.category))) continue;
    let saved = 0;
    for (let page = 1; page <= maxPagesPerOtt; page++) {
      if (!(await hasCategoryRoom(s.category))) break;
      const data = await fetchPage(`/discover/${s.type}`, {
        page,
        sort_by: 'popularity.desc',
        include_adult: false,
        language: 'en-US',
        with_watch_providers: s.ott.providerIds,
        watch_region: s.ott.watchRegion,
      });
      if (!data?.results?.length) break;
      saved += await saveAndTag(data.results, s.type, {
        ottKey: s.ott.key,
        isWebSeries: s.isWebSeries,
      });
      if (page >= Math.min(data.total_pages || 1, maxPagesPerOtt)) break;
    }
    await CrawlJob.updateOne(
      { name: 'ott' },
      { currentStep: s.step, $inc: { titlesSaved: saved }, lastActivityAt: new Date() },
    );
    logger.info(`Crawler [OTT]: ${s.step} done (${saved} items)`);
  }

  await CrawlJob.updateOne({ name: 'ott' }, { status: 'done', finishedAt: new Date() });
}

/** Helper to crawl a single discover slice (1–4 pages max per slice per year) */
async function crawlDiscoverSlice({ type, category, year, params, tags, sliceLimit }) {
  const maxPages = Math.min(Math.ceil(sliceLimit / PAGE_SIZE), 10);
  let page = 1;
  let totalPages = 1;
  let saved = 0;

  do {
    if (!(await hasCategoryRoom(category))) break;
    const data = await fetchPage(`/discover/${type}`, {
      sort_by: 'popularity.desc',
      include_adult: false,
      language: 'en-US',
      page,
      [type === 'movie' ? 'primary_release_year' : 'first_air_date_year']: year,
      'vote_count.gte': env.crawler?.minVotes || undefined,
      ...params,
    });
    if (!data?.results?.length) break;
    totalPages = Math.min(data.total_pages || 1, maxPages);
    const results = data.results.slice(0, Math.max(0, sliceLimit - saved));
    saved += await saveAndTag(results, type, tags);
    page += 1;
  } while (page <= totalPages && saved < sliceLimit);

  return saved;
}

/**
 * Crawls ONE category (`movie` | `webseries` | `tv`) for ONE year (`year`),
 * strictly stopping as soon as `yearCap` (1,200 for movie, 700 for webseries, 700 for tv)
 * is reached for that year so a single year NEVER pulls 16,000 items!
 */
async function crawlCategoryForYear(category, year) {
  if (!(await hasCategoryRoom(category))) return 0;

  const isMovie = category === 'movie';
  const isWeb = category === 'webseries';
  const tmdbType = isMovie ? 'movie' : 'tv';
  const yearCap = isMovie
    ? quotas.maxPerYearMovie
    : isWeb
      ? quotas.maxPerYearWebSeries
      : quotas.maxPerYearTv;

  const perRegionSlice = Math.min(Number(env.crawler?.perRegionLimit) || 60, 80);
  const perGenreSlice = Math.min(Number(env.crawler?.perGenreLimit) || 60, 80);
  const perOttSlice = Math.min(Number(env.crawler?.perOttLimit) || 80, 100);

  let savedThisYear = 0;

  if (isWeb) {
    for (const ott of OTT_CRAWL_TARGETS) {
      if (savedThisYear >= yearCap || !(await hasCategoryRoom('webseries'))) break;
      const budgetLeft = Math.min(perOttSlice, yearCap - savedThisYear);
      savedThisYear += await crawlDiscoverSlice({
        type: 'tv',
        category: 'webseries',
        year,
        sliceLimit: budgetLeft,
        params: {
          with_watch_providers: ott.providerIds,
          watch_region: ott.watchRegion,
        },
        tags: { ottKey: ott.key, isWebSeries: true },
      });
    }
    for (const r of REGIONS.slice(0, 10)) {
      if (savedThisYear >= yearCap || !(await hasCategoryRoom('webseries'))) break;
      const budgetLeft = Math.min(perRegionSlice, yearCap - savedThisYear);
      savedThisYear += await crawlDiscoverSlice({
        type: 'tv',
        category: 'webseries',
        year,
        sliceLimit: budgetLeft,
        params: {
          with_original_language: r.language,
          with_origin_country: r.country,
          with_watch_monetization_types: 'flatrate',
          watch_region: r.country || 'IN',
        },
        tags: { regionKey: r.key, isWebSeries: true },
      });
    }
  } else {
    const genres = await Genre.find({ mediaTypes: tmdbType }).distinct('tmdbId');

    for (const r of REGIONS) {
      if (savedThisYear >= yearCap || !(await hasCategoryRoom(category))) break;
      const budgetLeft = Math.min(perRegionSlice, yearCap - savedThisYear);
      savedThisYear += await crawlDiscoverSlice({
        type: tmdbType,
        category,
        year,
        sliceLimit: budgetLeft,
        params: {
          with_original_language: r.language,
          with_origin_country: r.country,
        },
        tags: { regionKey: r.key, isWebSeries: false },
      });
    }

    for (const g of genres) {
      if (savedThisYear >= yearCap || !(await hasCategoryRoom(category))) break;
      const budgetLeft = Math.min(perGenreSlice, yearCap - savedThisYear);
      savedThisYear += await crawlDiscoverSlice({
        type: tmdbType,
        category,
        year,
        sliceLimit: budgetLeft,
        params: { with_genres: g },
        tags: { isWebSeries: false },
      });
    }
  }

  await CrawlJob.updateOne(
    { name: category },
    {
      status: 'running',
      currentYear: year,
      currentStep: `year:${year}`,
      $inc: { titlesSaved: savedThisYear },
      targetCap: quotas[category],
      lastActivityAt: new Date(),
    },
    { upsert: true },
  );

  return savedThisYear;
}

/**
 * Phase 3: Interleaved Year-by-Year Crawl
 */
async function crawlInterleavedByYear(restart = false) {
  const newestYear = new Date().getFullYear() + 1;
  const oldestYear = Math.min(env.crawler?.movieFromYear || 1975, env.crawler?.tvFromYear || 1985);

  let masterJob = await CrawlJob.findOne({ name: 'interleaved' });
  if (!masterJob || restart) {
    masterJob = await CrawlJob.findOneAndUpdate(
      { name: 'interleaved' },
      {
        status: 'running',
        currentYear: newestYear,
        currentStep: 'movie',
        titlesSaved: 0,
        targetCap: quotas.total,
        startedAt: new Date(),
        finishedAt: null,
        lastError: null,
      },
      { upsert: true, new: true },
    );
    for (const cat of ['movie', 'webseries', 'tv']) {
      await CrawlJob.findOneAndUpdate(
        { name: cat },
        { status: 'running', currentYear: newestYear, titlesSaved: 0, targetCap: quotas[cat], startedAt: new Date(), finishedAt: null, lastError: null },
        { upsert: true },
      );
    }
  } else {
    await CrawlJob.updateOne({ name: 'interleaved' }, { status: 'running', targetCap: quotas.total, lastError: null });
  }

  const startYear = Math.min(masterJob.currentYear ?? newestYear, newestYear);

  for (let year = startYear; year >= oldestYear; year--) {
    if (stopRequested) throw new StopSignal('Stopped by superadmin');
    const counts = await getCategoryCounts();
    if (counts.total >= quotas.total) {
      throw new AllQuotasFullSignal(`Reached 1-Lakh (${quotas.total.toLocaleString()}) total cap`);
    }
    if (counts.movie >= quotas.movie && counts.tv >= quotas.tv && counts.webseries >= quotas.webseries) {
      throw new AllQuotasFullSignal('All category quotas (Movies, TV Shows, Web Series) are full!');
    }

    const mSaved = await crawlCategoryForYear('movie', year);
    const wSaved = await crawlCategoryForYear('webseries', year);
    const tSaved = await crawlCategoryForYear('tv', year);

    await CrawlJob.updateOne(
      { name: 'interleaved' },
      {
        currentYear: year - 1,
        currentStep: `Completed ${year} (Movies: +${mSaved}, WebSeries: +${wSaved}, TV: +${tSaved})`,
        $inc: { titlesSaved: mSaved + wSaved + tSaved },
        lastActivityAt: new Date(),
      },
    );

    logger.info(
      `Crawler [Year ${year}]: Movies +${mSaved} | Web Series +${wSaved} | TV Shows +${tSaved}`,
    );
  }

  await CrawlJob.updateMany(
    { name: { $in: ['interleaved', 'movie', 'webseries', 'tv'] } },
    { status: 'done', finishedAt: new Date() },
  );
}

/** Phase 4: Enrich top Movies, TV Shows & Web Series with budget, box office, trailers & songs */
async function enrichPopularTitles(maxEnrich = 300) {
  const pending = { detailsFetched: { $ne: true }, detailsFailed: { $ne: true }, voteCount: { $gte: env.crawler?.enrichMinVotes || 100 } };
  let enriched = 0;
  while (enriched < maxEnrich) {
    if (stopRequested) throw new StopSignal('Stopped by superadmin');
    const batch = await Title.find(pending).sort({ popularity: -1 }).limit(40);
    if (!batch.length) return;
    for (const t of batch) {
      if (stopRequested) throw new StopSignal('Stopped by superadmin');
      const filter = { mediaType: t.mediaType, tmdbId: t.tmdbId };
      try {
        const data = await fetchPage(`/${t.mediaType}/${t.tmdbId}`, {
          append_to_response: 'credits,videos,images,watch/providers,reviews,release_dates,content_ratings,keywords,external_ids',
          language: 'en-US',
        });
        await Title.updateOne(filter, data ? { $set: fromDetails(data, t.mediaType, t) } : { detailsFailed: true });
        enriched += 1;
      } catch (err) {
        if (err instanceof StopSignal) throw err;
        await Title.updateOne(filter, { detailsFailed: true });
      }
    }
  }
}

/** Starts or resumes the Quota-Balanced 1-Lakh Crawler in the background. */
export function startCrawl({ restart = false, targetCap, quotasConfig, mode = 'full' } = {}) {
  if (running) throw ApiError.conflict('The crawler is already running');
  if (quotasConfig) setTargetCap(quotasConfig);
  else if (targetCap) setTargetCap(targetCap);

  running = true;
  stopRequested = false;

  (async () => {
    try {
      await syncGenres();

      if (mode === 'popular') {
        await crawlPopularAndTrending(true, { ignoreQuotaCap: true });
      } else if (mode === 'ott') {
        await crawlOttProviders(true);
      } else if (mode === 'enrich') {
        await enrichPopularTitles(250);
      } else {
        await crawlPopularAndTrending(restart);
        await crawlOttProviders(restart);
        await crawlInterleavedByYear(restart);
        logger.info('Crawler: enriching popular titles with budget, collection, trailers & songs...');
        await enrichPopularTitles(300);
      }
      logger.success('Crawler: finished successfully');
    } catch (err) {
      if (err instanceof AllQuotasFullSignal) {
        logger.success(`Crawler: ${err.message}`);
        await CrawlJob.updateMany(
          { status: 'running' },
          { status: 'capped_at_target', finishedAt: new Date(), lastError: err.message },
        );
      } else if (err instanceof StopSignal) {
        logger.warn('Crawler stopped by superadmin');
        await CrawlJob.updateMany({ status: 'running' }, { status: 'stopped', lastError: err.message });
      } else {
        logger.error('Crawler failed:', err.message);
        await CrawlJob.updateMany({ status: 'running' }, { status: 'failed', lastError: err.message });
      }
    } finally {
      running = false;
      stopRequested = false;
    }
  })();
}

async function refreshRecentYears() {
  if (running) return;
  running = true;
  stopRequested = false;
  try {
    await crawlPopularAndTrending(true, { ignoreQuotaCap: true });
    logger.success('Crawler: rotated fresh Trending, Popular, Now Playing & Upcoming titles');
  } catch (err) {
    if (!(err instanceof StopSignal) && !(err instanceof AllQuotasFullSignal)) {
      logger.warn('Crawler refresh failed:', err.message);
    }
  } finally {
    running = false;
    stopRequested = false;
  }
}

export const startScheduler = () => setInterval(refreshRecentYears, (env.crawler?.refreshHours || 24) * 3_600_000).unref();

export async function getCrawlerStatus() {
  const [jobs, counts, enrichedCount, byRegion, byOtt] = await Promise.all([
    CrawlJob.find().lean(),
    getCategoryCounts(),
    Title.countDocuments({ detailsFetched: true }),
    Title.aggregate([
      { $unwind: '$regions' },
      { $group: { _id: { region: '$regions', type: '$mediaType' }, count: { $sum: 1 } } },
    ]),
    Title.aggregate([
      { $unwind: '$ottProviders' },
      { $group: { _id: '$ottProviders', count: { $sum: 1 } } },
    ]),
  ]);

  const regions = {};
  for (const { _id, count } of byRegion) {
    (regions[_id.region] ??= { movie: 0, tv: 0 })[_id.type] = count;
  }

  const ottBreakdown = {};
  for (const { _id, count } of byOtt) {
    ottBreakdown[_id] = count;
  }

  return {
    running,
    targetCap: quotas.total,
    quotas: {
      total: quotas.total,
      movie: quotas.movie,
      tv: quotas.tv,
      webseries: quotas.webseries,
      maxPerYearMovie: quotas.maxPerYearMovie,
      maxPerYearTv: quotas.maxPerYearTv,
      maxPerYearWebSeries: quotas.maxPerYearWebSeries,
    },
    progressPercent: Math.min(100, Math.round((counts.total / quotas.total) * 1000) / 10),
    quotaProgress: {
      moviePercent: Math.min(100, Math.round((counts.movie / quotas.movie) * 1000) / 10),
      tvPercent: Math.min(100, Math.round((counts.tv / quotas.tv) * 1000) / 10),
      webSeriesPercent: Math.min(100, Math.round((counts.webseries / quotas.webseries) * 1000) / 10),
    },
    limits: {
      maxTotalTitles: quotas.total,
      movieQuota: quotas.movie,
      tvQuota: quotas.tv,
      webSeriesQuota: quotas.webseries,
      maxPerYearMovie: quotas.maxPerYearMovie,
      maxPerYearTv: quotas.maxPerYearTv,
      maxPerYearWebSeries: quotas.maxPerYearWebSeries,
      perGenrePerYear: Math.min(Number(env.crawler?.perGenreLimit) || 60, 80),
      perRegionPerYear: Math.min(Number(env.crawler?.perRegionLimit) || 60, 80),
      perOttLimit: Math.min(Number(env.crawler?.perOttLimit) || 80, 100),
    },
    jobs: jobs.map(({ _id, __v, ...j }) => j),
    titlesInDatabase: {
      movies: counts.movie,
      tv: counts.tv,
      totalTvAndWeb: counts.totalTv,
      webSeries: counts.webseries,
      enrichedWithFullDetails: enrichedCount,
      total: counts.total,
      remainingToTarget: Math.max(0, quotas.total - counts.total),
    },
    titlesByRegion: regions,
    titlesByOtt: ottBreakdown,
  };
}
