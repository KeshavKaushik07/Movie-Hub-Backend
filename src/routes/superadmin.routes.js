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

r.use(protect, authorize('admin', 'superadmin'));

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

// TMDB API Key Pool Management (Strictly SuperAdmin Only)
r.get('/api-keys', authorize('superadmin'), listKeys);
r.post('/api-keys', authorize('superadmin'), addKey);
r.patch('/api-keys/:id', authorize('superadmin'), updateKey);
r.delete('/api-keys/:id', authorize('superadmin'), deleteKey);
r.post('/api-keys/:id/test', authorize('superadmin'), testKey);

// 1-Lakh Background Crawler Controls (Strictly SuperAdmin Only)
r.get('/crawler', authorize('superadmin'), crawlerStatus);
r.post('/crawler/start', authorize('superadmin'), crawlerStart);
r.post('/crawler/stop', authorize('superadmin'), crawlerStop);
r.patch('/crawler/cap', authorize('superadmin'), crawlerUpdateCap);

export default r;
