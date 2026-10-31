// Loads .env and exports tidy settings. Must be imported FIRST in server.js
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const e = process.env;
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : fallback);
const isProd = e.NODE_ENV === 'production';

const env = {
  isProd,
  nodeEnv: e.NODE_ENV,
  port: num(e.PORT, 5000),
  mongoUri: e.MONGO_URI,
  origins: (e.CORS_ORIGINS || e.CLIENT_URL || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  encryptionSecret: e.ENCRYPTION_SECRET,
  jwt: {
    accessSecret: e.JWT_ACCESS_SECRET,
    refreshSecret: e.JWT_REFRESH_SECRET,
    accessTtl: `${num(e.ACCESS_TOKEN_TTL_MINUTES, 120)}m`,
    refreshDays: num(e.REFRESH_TOKEN_TTL_DAYS, 30),
  },
  // In production (Vercel frontend + Render backend), SameSite must default to 'none' (with Secure: true) so cross-origin cookies are accepted
  cookie: {
    sameSite: e.COOKIE_SAMESITE || (isProd ? 'none' : 'lax'),
    domain: e.COOKIE_DOMAIN || undefined,
  },
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
    maxTitles: num(e.CRAWL_MAX_TITLES, 100_000),
    movieQuota: num(e.CRAWL_MOVIE_QUOTA, 50_000),
    tvQuota: num(e.CRAWL_TV_QUOTA, 25_000),
    webSeriesQuota: num(e.CRAWL_WEBSERIES_QUOTA, 25_000),
    maxPerYearMovie: num(e.CRAWL_MAX_PER_YEAR_MOVIE, 1200),
    maxPerYearTv: num(e.CRAWL_MAX_PER_YEAR_TV, 700),
    maxPerYearWebSeries: num(e.CRAWL_MAX_PER_YEAR_WEBSERIES, 700),
    delayMs: num(e.CRAWL_DELAY_MS, 60),
    movieFromYear: num(e.CRAWL_MOVIE_FROM_YEAR, 1975),
    tvFromYear: num(e.CRAWL_TV_FROM_YEAR, 1985),
    minVotes: num(e.CRAWL_MIN_VOTES, 0),
    enrichMinVotes: num(e.ENRICH_MIN_VOTES, 100),
    perGenreLimit: num(e.CRAWL_PER_GENRE_LIMIT, 60),
    perRegionLimit: num(e.CRAWL_PER_REGION_LIMIT, 60),
    perOttLimit: num(e.CRAWL_PER_OTT_LIMIT, 80),
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
