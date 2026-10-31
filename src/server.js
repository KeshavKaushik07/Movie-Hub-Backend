import dns from 'node:dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);
import env, { assertEnv } from './config/env.js';
import app from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import seedSuperAdmin from './seeds/superadmin.seed.js';
import { seedApiKeyFromEnv } from './services/apiKey.service.js';
import { loadGenres } from './services/title.service.js';
import { seedDefaultCommunityRooms } from './services/communityHub.service.js';
import {
  startCrawl,
  startScheduler,
  requestStop,
} from './services/crawler.service.js';
import {
  startHealthCheckCron,
  stopHealthCheckCron,
} from './cron/healthCheck.cron.js';
import logger from './utils/logger.js';

let server;

const start = async () => {
  assertEnv();
  await connectDB();
  await seedSuperAdmin();
  await seedApiKeyFromEnv();
  await loadGenres();
  await seedDefaultCommunityRooms();

  server = app.listen(env.port, () => {
    logger.ok(
      `Movies Hub API running on http://localhost:${env.port}/api/v1 [${env.nodeEnv}]`,
    );
    if (env.crawler.onBoot) {
      startCrawl().catch((e) => logger.warn('Boot crawl skipped:', e.message));
    }
    startScheduler();
    startHealthCheckCron();
  });
};

const shutdown = async (signal) => {
  logger.warn(`${signal} received — shutting down gracefully`);
  requestStop();
  stopHealthCheckCron();
  if (server) server.close();
  await disconnectDB();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) =>
  logger.error('UnhandledRejection:', err),
);

start().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
