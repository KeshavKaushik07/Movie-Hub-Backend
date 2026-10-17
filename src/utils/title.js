import ApiError from './ApiError.js';

// Reads /titles/:type/:tmdbId from the URL. Normalizes 'webseries' -> 'tv' for canonical identity
export const parseTitle = (req) => {
  const rawType = String(req.params.type || '').toLowerCase();
  const type = rawType === 'webseries' ? 'tv' : rawType;
  const id = Number(req.params.tmdbId);
  if (!['movie', 'tv'].includes(type) || !Number.isInteger(id) || id <= 0) {
    throw ApiError.badRequest('Invalid title type or ID');
  }
  return { type, tmdbId: id };
};
