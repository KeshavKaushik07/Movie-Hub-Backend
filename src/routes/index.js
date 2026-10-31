import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import discoverRoutes from './discover.routes.js';
import titleRoutes from './title.routes.js';
import watchlistRoutes from './watchlist.routes.js';
import adminRoutes from './admin.routes.js';
import superadminRoutes from './superadmin.routes.js';
import featuredRoutes from './featured.routes.js';
import blogRoutes from './blog.routes.js';
import communityRoutes from './community.routes.js';
import tmdbRoutes from './tmdb.routes.js';
import { getHealthStatusPayload } from '../cron/healthCheck.cron.js';
import { syncCheck } from '../controller/discover.controller.js';

const r = Router();

r.get('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(getHealthStatusPayload());
});

r.head('/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).end();
});

r.get('/sync-check', syncCheck);
r.post('/sync-check', syncCheck);

r.use('/auth', authRoutes);
r.use('/users', userRoutes);
r.use('/discover', discoverRoutes);
r.use('/featured', featuredRoutes);
r.use('/blogs', blogRoutes);
r.use('/community', communityRoutes);
r.use('/watchlist', watchlistRoutes);
r.use('/admin', adminRoutes);
r.use('/superadmin', superadminRoutes);
r.use('/', titleRoutes);
r.use('/tmdb', tmdbRoutes);
r.use('/', tmdbRoutes);

export default r;
