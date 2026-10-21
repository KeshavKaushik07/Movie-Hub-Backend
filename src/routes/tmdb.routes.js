import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import { LISTS, findTitles } from '../services/title.service.js';
import { getTitle, getSeason } from '../controller/title.controller.js';

/*
 TMDB-Compatible Mirror Routes:
 Allows the frontend to call our backend using exact TMDB URL patterns:
 - GET /api/v1/trending/:type/:window
 - GET /api/v1/search/:type?query=...
 - GET /api/v1/movie/popular | top_rated | now_playing | upcoming
 - GET /api/v1/tv/popular | top_rated | on_the_air | airing_today
 - GET /api/v1/movie/:tmdbId
 - GET /api/v1/tv/:tmdbId
 - GET /api/v1/tv/:tmdbId/season/:seasonNumber
 Every route checks MongoDB first; if not present in MongoDB, fetches from TMDB, stores in MongoDB, and serves!
*/
const router = Router();

// GET /trending/:type/:window
router.get(
  '/trending/:type/:window',
  asyncHandler(async (req, res) => {
    const type = ['movie', 'tv'].includes(req.params.type) ? req.params.type : 'movie';
    const { extra, sort } = LISTS.trending();
    res.json(await findTitles({ ...req.query, type }, { extra, sort, listName: 'trending' }));
  }),
);

// GET /search/:type?query=batman
router.get(
  '/search/:type',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q || req.query.query || '').trim();
    const type = ['movie', 'tv'].includes(req.params.type) ? req.params.type : undefined;
    res.json(await findTitles({ ...req.query, type, q }));
  }),
);

const CATEGORY_MAP = {
  popular: 'popular',
  top_rated: 'top-rated',
  'top-rated': 'top-rated',
  now_playing: 'now-playing',
  'now-playing': 'now-playing',
  on_the_air: 'now-playing',
  airing_today: 'upcoming',
  upcoming: 'upcoming',
};

// GET /:type/:categoryOrId (where :type is movie | tv)
router.get(
  '/:type(movie|tv)/:categoryOrId',
  asyncHandler(async (req, res, next) => {
    const { type, categoryOrId } = req.params;
    if (CATEGORY_MAP[categoryOrId]) {
      const listKey = CATEGORY_MAP[categoryOrId];
      const { extra, sort } = LISTS[listKey]();
      return res.json(await findTitles({ ...req.query, type }, { extra, sort, listName: listKey }));
    }
    if (/^\d+$/.test(categoryOrId)) {
      req.params.tmdbId = categoryOrId;
      return getTitle(req, res, next);
    }
    return next();
  }),
);

// GET /tv/:tmdbId/season/:seasonNumber
router.get('/tv/:tmdbId/season/:seasonNumber', getSeason);

export default router;
