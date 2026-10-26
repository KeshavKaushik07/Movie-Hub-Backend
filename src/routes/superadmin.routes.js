import { Router } from 'express';
import {
  createStaffOrUser,
  listDatabaseTitles,
  createCustomTitle,
  updateTitleDetails,
  syncTitleFromTmdb,
  deleteTitleFromDb,
  listKeys,
  addKey,
  updateKey,
  deleteKey,
  testKey,
  crawlerStatus,
  crawlerStart,
  crawlerStop,
  crawlerUpdateCap,
} from '../controller/superadmin.controller.js';
import {
  listAdminFeatured,
  updateHeroConfig,
  addFeaturedItem,
  updateFeaturedItem,
  reorderFeaturedItems,
  removeFeaturedItem,
} from '../controller/featured.controller.js';
import { protect, authorize } from '../middleware/auth.middleware.js';

const r = Router();

r.use(protect, authorize('superadmin'));

// Staff & User Account Creation
r.post('/users', createStaffOrUser);

// Full Database Media Management (Movies / TV / Web Series / Box Office / Songs)
r.get('/titles', listDatabaseTitles);
r.post('/titles', createCustomTitle);
r.patch('/titles/:type/:tmdbId', updateTitleDetails);
r.post('/titles/:type/:tmdbId/sync', syncTitleFromTmdb);
r.delete('/titles/:type/:tmdbId', deleteTitleFromDb);

// Home Hero Featured Carousel Management
r.get('/featured', listAdminFeatured);
r.patch('/featured/config', updateHeroConfig);
r.post('/featured', addFeaturedItem);
r.put('/featured/reorder', reorderFeaturedItems);
r.patch('/featured/:id', updateFeaturedItem);
r.delete('/featured/:id', removeFeaturedItem);

// TMDB API Key Pool Management
r.get('/api-keys', listKeys);
r.post('/api-keys', addKey);
r.patch('/api-keys/:id', updateKey);
r.delete('/api-keys/:id', deleteKey);
r.post('/api-keys/:id/test', testKey);

// 1-Lakh Background Crawler Controls
r.get('/crawler', crawlerStatus);
r.post('/crawler/start', crawlerStart);
r.post('/crawler/stop', crawlerStop);
r.patch('/crawler/cap', crawlerUpdateCap);

export default r;
