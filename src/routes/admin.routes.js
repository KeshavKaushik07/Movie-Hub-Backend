import { Router } from 'express';
import {
  getStats,
  listUsers,
  removeUser,
  setRole,
  setActive,
  listAllReviews,
  moderateReview,
  adminDeleteReview,
  listAllComments,
  moderateComment,
  adminDeleteComment,
} from '../controller/admin.controller.js';
import { protect, authorize } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constant.js';

const router = Router();
router.use(protect, authorize(ROLES.ADMIN, ROLES.SUPERADMIN));

// Analytics & Dashboard
router.get('/stats', getStats);

// User Management
router.get('/users', listUsers);
router.patch('/users/:id/active', setActive);
router.delete('/users/:id', authorize(ROLES.SUPERADMIN), removeUser);
router.patch('/users/:id/role', authorize(ROLES.SUPERADMIN), setRole);

// Reviews & Critic Reviews Moderation (Admin + SuperAdmin)
router.get('/reviews', listAllReviews);
router.patch('/reviews/:id', moderateReview);
router.delete('/reviews/:id', adminDeleteReview);

// Comments Moderation (Admin + SuperAdmin)
router.get('/comments', listAllComments);
router.patch('/comments/:id', moderateComment);
router.delete('/comments/:id', adminDeleteComment);

export default router;
