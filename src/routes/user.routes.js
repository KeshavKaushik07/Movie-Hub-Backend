import { Router } from 'express';
import { updateMe, changePassword, deleteMe } from '../controller/user.controller.js';
import { myReviews } from '../controller/review.controller.js';
import { protect } from '../middleware/auth.middleware.js';
import { authLimiter } from '../middleware/security.middleware.js';

const router = Router();
router.use(protect);
router.patch('/me', updateMe);
router.patch('/me/password', authLimiter, changePassword);
router.delete('/me', deleteMe);
router.get('/me/reviews', myReviews);

export default router;
