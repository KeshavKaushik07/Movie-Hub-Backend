import { Router } from 'express';
import { listWatchlist, saveWatchlistItem, removeWatchlistItem } from '../controller/watchlist.controller.js';
import { protect } from '../middleware/auth.middleware.js';

const router = Router();
router.use(protect);
router.get('/', listWatchlist);
router.put('/:type/:tmdbId', saveWatchlistItem);
router.delete('/:type/:tmdbId', removeWatchlistItem);

export default router;
