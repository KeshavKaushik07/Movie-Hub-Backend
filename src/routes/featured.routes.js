import { Router } from 'express';
import {
  listPublicFeatured,
  listAdminFeatured,
  updateHeroConfig,
  addFeaturedItem,
  updateFeaturedItem,
  reorderFeaturedItems,
  removeFeaturedItem,
} from '../controller/featured.controller.js';
import { protect, authorize } from '../middleware/auth.middleware.js';

const r = Router();

// Public: Get active Featured Hero Carousel items & slide limit
r.get('/', listPublicFeatured);

// Admin & SuperAdmin: Manage Home Hero Carousel items & slide count limit
r.get('/admin', protect, authorize('admin', 'superadmin'), listAdminFeatured);
r.patch('/config', protect, authorize('admin', 'superadmin'), updateHeroConfig);
r.post('/', protect, authorize('admin', 'superadmin'), addFeaturedItem);
r.put('/reorder', protect, authorize('admin', 'superadmin'), reorderFeaturedItems);
r.patch('/:id', protect, authorize('admin', 'superadmin'), updateFeaturedItem);
r.delete('/:id', protect, authorize('admin', 'superadmin'), removeFeaturedItem);

export default r;
