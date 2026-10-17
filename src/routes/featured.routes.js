import { Router } from 'express';
import {
  listPublicFeatured,
  listAdminFeatured,
  addFeaturedItem,
  updateFeaturedItem,
  reorderFeaturedItems,
  removeFeaturedItem,
} from '../controller/featured.controller.js';
import { protect, authorize } from '../middleware/auth.middleware.js';

const r = Router();

// Public: Get active Featured Hero Carousel items
r.get('/', listPublicFeatured);

// Admin & SuperAdmin: Manage Home Hero Carousel items
r.get('/admin', protect, authorize('admin', 'superadmin'), listAdminFeatured);
r.post('/', protect, authorize('admin', 'superadmin'), addFeaturedItem);
r.put('/reorder', protect, authorize('admin', 'superadmin'), reorderFeaturedItems);
r.patch('/:id', protect, authorize('admin', 'superadmin'), updateFeaturedItem);
r.delete('/:id', protect, authorize('admin', 'superadmin'), removeFeaturedItem);

export default r;
