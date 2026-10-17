import { Router } from 'express';
import { getTitle, similarTitles, getSeason } from '../controller/title.controller.js';
import { listReviews, saveReview, addCriticReview, toggleReviewLike, deleteReview } from '../controller/review.controller.js';
import { listComments, addComment, deleteComment, toggleLike } from '../controller/comment.controller.js';
import { protect, optionalAuth, authorize } from '../middleware/auth.middleware.js';
import { ROLES } from '../config/constant.js';

const router = Router();

// Title details, similar & TV seasons (DB-first -> TMDB fallback -> store -> serve)
router.get('/titles/:type/:tmdbId', getTitle);
router.get('/titles/:type/:tmdbId/similar', similarTitles);
router.get('/titles/tv/:tmdbId/season/:seasonNumber', getSeason);

// Reviews (User reviews + Critic reviews)
router.get('/titles/:type/:tmdbId/reviews', optionalAuth, listReviews);
router.put('/titles/:type/:tmdbId/reviews', protect, saveReview);
router.post('/titles/:type/:tmdbId/critic-reviews', protect, authorize(ROLES.ADMIN, ROLES.SUPERADMIN), addCriticReview);
router.post('/reviews/:id/like', protect, toggleReviewLike);
router.delete('/reviews/:id', protect, deleteReview);

// Comments & replies
router.get('/titles/:type/:tmdbId/comments', optionalAuth, listComments);
router.post('/titles/:type/:tmdbId/comments', protect, addComment);
router.delete('/comments/:id', protect, deleteComment);
router.post('/comments/:id/like', protect, toggleLike);

export default router;
