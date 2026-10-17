// Loads .env and exports tidy settings. Must be imported FIRST in server.js
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const e = process.env;
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : fallback);

const env = {
  nodeEnv: e.NODE_ENV || 'development',
  isProd: e.NODE_ENV === 'production',
  port: num(e.PORT, 5000),
  mongoUri: e.MONGO_URI,
  origins: (e.CORS_ORIGINS || e.CLIENT_URL || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  encryptionSecret: e.ENCRYPTION_SECRET,
  jwt: {
    accessSecret: e.JWT_ACCESS_SECRET,
    refreshSecret: e.JWT_REFRESH_SECRET,
    accessTtl: `${num(e.ACCESS_TOKEN_TTL_MINUTES, 15)}m`,
    refreshDays: num(e.REFRESH_TOKEN_TTL_DAYS, 7),
  },
  cookie: { sameSite: e.COOKIE_SAMESITE || 'lax', domain: e.COOKIE_DOMAIN || undefined },
  bcryptRounds: num(e.BCRYPT_ROUNDS, 12),
  maxAttempts: num(e.MAX_LOGIN_ATTEMPTS, 5),
  lockMinutes: num(e.LOCK_TIME_MINUTES, 15),
  tmdb: {
    baseUrl: e.TMDB_BASE_URL || 'https://api.themoviedb.org/3',
    imageBase: 'https://image.tmdb.org/t/p',
    seedKey: e.TMDB_API_KEY,
    cooldownMinutes: num(e.TMDB_COOLDOWN_MINUTES, 10),
  },
  crawler: {
    onBoot: e.CRAWL_ON_BOOT !== 'false',
    maxTitles: num(e.CRAWL_MAX_TITLES, 100_000),              // 1 Lakh (100,000) total cap
    movieQuota: num(e.CRAWL_MOVIE_QUOTA, 50_000),             // 50,000 Movies quota
    tvQuota: num(e.CRAWL_TV_QUOTA, 25_000),                   // 25,000 TV Shows quota
    webSeriesQuota: num(e.CRAWL_WEBSERIES_QUOTA, 25_000),     // 25,000 Web Series (OTT) quota
    maxPerYearMovie: num(e.CRAWL_MAX_PER_YEAR_MOVIE, 1200),   // Max movies fetched from a single year (prevents 16,000 from 1 year!)
    maxPerYearTv: num(e.CRAWL_MAX_PER_YEAR_TV, 700),          // Max TV shows fetched from a single year
    maxPerYearWebSeries: num(e.CRAWL_MAX_PER_YEAR_WEBSERIES, 700), // Max Web Series fetched from a single year
    delayMs: num(e.CRAWL_DELAY_MS, 60),
    movieFromYear: num(e.CRAWL_MOVIE_FROM_YEAR, 1975),
    tvFromYear: num(e.CRAWL_TV_FROM_YEAR, 1985),
    minVotes: num(e.CRAWL_MIN_VOTES, 0),
    enrichMinVotes: num(e.ENRICH_MIN_VOTES, 100),
    perGenreLimit: num(e.CRAWL_PER_GENRE_LIMIT, 60),          // 60 top titles per genre per year (3 pages)
    perRegionLimit: num(e.CRAWL_PER_REGION_LIMIT, 60),        // 60 top titles per industry per year (3 pages)
    perOttLimit: num(e.CRAWL_PER_OTT_LIMIT, 80),              // 80 top titles per OTT provider per year (4 pages)
    refreshHours: num(e.CRAWL_REFRESH_HOURS, 24),
  },
};

export const assertEnv = () => {
  const missing = [
    ['MONGO_URI', env.mongoUri],
    ['JWT_ACCESS_SECRET', env.jwt.accessSecret],
    ['JWT_REFRESH_SECRET', env.jwt.refreshSecret],
    ['ENCRYPTION_SECRET', env.encryptionSecret],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`Missing in .env: ${missing.join(', ')}`);
};

export default env;
