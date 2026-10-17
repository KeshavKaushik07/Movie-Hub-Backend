import { Router } from 'express';
import * as c from '../controller/discover.controller.js';

const router = Router();
router.get('/', c.browse);
router.get('/home', c.homeFeed);
router.get('/search', c.search);
router.get('/celebrities', c.celebrities);
router.get('/person', c.personDetails);
router.get('/person/:name', c.personDetails);
router.get('/genres', c.genres);
router.get('/industries', c.industries);
router.get('/ott-providers', c.ottProviders);
router.get('/genre/:genreId', c.byGenre);
router.get('/year/:year', c.byYear);
router.get('/language/:code', c.byLanguage);
router.get('/industry/:name', c.byIndustry);
router.get('/ott/:providerKey', c.byOtt);
router.get('/lists/:name', c.lists);

router.get('/movie', (req, res, next) => {
  req.query.type = 'movie';
  return c.browse(req, res, next);
});
router.get('/tv', (req, res, next) => {
  req.query.type = 'tv';
  return c.browse(req, res, next);
});
router.get('/webseries', (req, res, next) => {
  req.query.type = 'webseries';
  return c.browse(req, res, next);
});

export default router;
