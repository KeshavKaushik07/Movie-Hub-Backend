import axios from 'axios';
import mongoose from 'mongoose';
import env from '../config/env.js';
import { API_PREFIX } from '../config/constant.js';
import { logger } from '../utils/logger.js';

/**
 * Render Keep-Alive Health Check Cron Job (`/api/v1/health`)
 *
 * Package required:
 *   npm install node-cron
 *
 * Runs every 3 to 4 minutes (default cron schedule: every 3 minutes -> every 3 minutes,
 * or configurable via `HEALTH_CRON_SCHEDULE` in `.env`, e.g. every 4 minutes).
 * Automatically pings your public Render URL (`RENDER_EXTERNAL_URL` or `BACKEND_PUBLIC_URL`)
 * at `/api/v1/health` so Render never spins down the backend instance due to inactivity.
 */

let scheduledTask = null;
let fallbackInterval = null;

const cronState = {
  enabled: true,
  schedule: process.env.HEALTH_CRON_SCHEDULE || '*/3 * * * *', // Every 3 minutes (3-4 min window)
  intervalMs: 3.5 * 60 * 1000, // 3.5 minutes fallback timer if node-cron is not yet installed
  targetUrl: '',
  totalPings: 0,
  lastPingAt: null,
  lastStatus: 'idle',
  lastResponseTimeMs: null,
  lastError: null,
};

/**
 * Resolves the target URL to ping:
 * 1. `process.env.BACKEND_PUBLIC_URL` or `process.env.HEALTH_CHECK_URL` (explicit custom URL)
 * 2. `process.env.RENDER_EXTERNAL_URL` (automatically injected by Render in production!)
 * 3. `http://localhost:${env.port}` (local development fallback)
 */
export const resolveHealthCheckUrl = () => {
  const explicitUrl = (
    process.env.HEALTH_CHECK_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');

  if (explicitUrl) {
    if (explicitUrl.endsWith('/health')) return explicitUrl;
    if (explicitUrl.endsWith(API_PREFIX)) return `${explicitUrl}/health`;
    return `${explicitUrl}${API_PREFIX}/health`;
  }

  return `http://127.0.0.1:${env.port}${API_PREFIX}/health`;
};

/**
 * Sends a single GET request to `/api/v1/health` to keep Render awake and warm.
 */
export const pingHealthEndpoint = async () => {
  const url = resolveHealthCheckUrl();
  cronState.targetUrl = url;
  const started = Date.now();

  try {
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'MoviesHub-Render-KeepAlive-Cron/1.0',
        'X-Health-Cron': 'true',
      },
    });
    const elapsed = Date.now() - started;
    cronState.totalPings += 1;
    cronState.lastPingAt = new Date().toISOString();
    cronState.lastStatus = res.status === 200 ? 'healthy' : `status_${res.status}`;
    cronState.lastResponseTimeMs = elapsed;
    cronState.lastError = null;

    logger.info(
      `[HealthCron] Ping #${cronState.totalPings} OK (${res.status}) -> ${url} in ${elapsed}ms`,
    );
    return true;
  } catch (err) {
    const elapsed = Date.now() - started;
    cronState.totalPings += 1;
    cronState.lastPingAt = new Date().toISOString();
    cronState.lastStatus = 'error';
    cronState.lastResponseTimeMs = elapsed;
    cronState.lastError = err.message || 'Health check ping failed';

    logger.warn(`[HealthCron] Ping failed -> ${url}: ${cronState.lastError}`);
    return false;
  }
};

/**
 * Starts the Render Keep-Alive Cron Job using `node-cron` (every 3-4 minutes).
 * Includes a safe native timer fallback if `node-cron` hasn't been installed yet.
 */
export const startHealthCheckCron = async () => {
  if (process.env.DISABLE_HEALTH_CRON === 'true') {
    cronState.enabled = false;
    logger.info('[HealthCron] Disabled via DISABLE_HEALTH_CRON=true');
    return;
  }

  stopHealthCheckCron();
  const targetUrl = resolveHealthCheckUrl();
  cronState.targetUrl = targetUrl;

  try {
    // Uses `node-cron` package (`npm install node-cron`)
    const cronModule = await import('node-cron');
    const cron = cronModule.default || cronModule;

    const expr = cron.validate(cronState.schedule)
      ? cronState.schedule
      : '*/3 * * * *';
    cronState.schedule = expr;

    scheduledTask = cron.schedule(expr, () => {
      pingHealthEndpoint();
    });

    logger.ok(
      `[HealthCron] Active with node-cron (${expr} — every 3-4 mins) -> ${targetUrl}`,
    );
  } catch {
    // Fallback if `npm install node-cron` hasn't been run yet so server still boots & stays awake
    logger.warn(
      '[HealthCron] `node-cron` package not found — using built-in 3.5-min timer fallback. Run `npm install node-cron` to use cron expressions.',
    );
    fallbackInterval = setInterval(() => {
      pingHealthEndpoint();
    }, cronState.intervalMs);
    if (fallbackInterval.unref) fallbackInterval.unref();
  }
};

export const stopHealthCheckCron = () => {
  if (scheduledTask) {
    try {
      scheduledTask.stop();
    } catch {
      /* ignore */
    }
    scheduledTask = null;
  }
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
  }
};

export const getHealthStatusPayload = () => {
  const dbReadyState = mongoose.connection?.readyState ?? 0;
  const dbStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  return {
    success: true,
    status: 'ok',
    service: 'movies-hub-api',
    environment: env.nodeEnv || 'development',
    uptimeSeconds: Math.round(process.uptime()),
    database: {
      state: dbStates[dbReadyState] || 'unknown',
      healthy: dbReadyState === 1,
    },
    keepAliveCron: {
      enabled: cronState.enabled,
      schedule: cronState.schedule,
      targetUrl: cronState.targetUrl || resolveHealthCheckUrl(),
      totalPings: cronState.totalPings,
      lastPingAt: cronState.lastPingAt,
      lastStatus: cronState.lastStatus,
      lastResponseTimeMs: cronState.lastResponseTimeMs,
    },
    timestamp: new Date().toISOString(),
  };
};

export default startHealthCheckCron;