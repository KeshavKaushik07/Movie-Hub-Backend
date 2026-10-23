import Watchlist from '../models/Watchlist.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { parseTitle } from '../utils/title.js';
import { WATCH_STATUS } from '../config/constant.js';
import { getOrFetchTitle, titlesByPairs } from '../services/title.service.js';

// GET /watchlist?status=planned
export const listWatchlist = asyncHandler(async (req, res) => {
  const filter = {
    user: req.user._id,
    ...(WATCH_STATUS.includes(req.query.status) ? { status: req.query.status } : {}),
  };
  const items = await Watchlist.find(filter).sort('-updatedAt').limit(200);
  const titles = await titlesByPairs(items.map((i) => ({ type: i.type, tmdbId: i.tmdbId })));
  res.json({
    items: items.map((i) => ({
      id: String(i._id),
      type: i.type,
      tmdbId: i.tmdbId,
      status: i.status,
      addedAt: i.createdAt,
      title: titles.get(`${i.type}:${i.tmdbId}`) || null,
    })),
  });
});

// PUT /watchlist/:type/:tmdbId { status }
export const saveWatchlistItem = asyncHandler(async (req, res) => {
  const parsed = parseTitle(req);
  const resolvedDoc = parsed.isSlug ? await getOrFetchTitle(parsed.type, parsed.slug) : null;
  const type = resolvedDoc?.mediaType || parsed.type;
  const tmdbId = resolvedDoc?.tmdbId || parsed.tmdbId;
  const status = req.body.status ?? 'planned';
  if (!WATCH_STATUS.includes(status)) {
    throw ApiError.badRequest(`Status must be one of: ${WATCH_STATUS.join(', ')}`);
  }
  await getOrFetchTitle(type, tmdbId);
  const item = await Watchlist.findOneAndUpdate(
    { user: req.user._id, type, tmdbId },
    { status },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  res.json({ item: { type, tmdbId, status: item.status } });
});

// DELETE /watchlist/:type/:tmdbId
export const removeWatchlistItem = asyncHandler(async (req, res) => {
  const parsed = parseTitle(req);
  const resolvedDoc = parsed.isSlug ? await getOrFetchTitle(parsed.type, parsed.slug) : null;
  const type = resolvedDoc?.mediaType || parsed.type;
  const tmdbId = resolvedDoc?.tmdbId || parsed.tmdbId;
  await Watchlist.deleteOne({ user: req.user._id, type, tmdbId });
  res.status(204).end();
});
