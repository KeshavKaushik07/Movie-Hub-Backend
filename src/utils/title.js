import ApiError from './ApiError.js';

export const slugifyTitle = (str = '') =>
  String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Reads /titles/:type/:tmdbId from the URL. Accepts EITHER a numeric TMDB ID OR a title slug (e.g. /titles/movie/mirzapur)
export const parseTitle = (req) => {
  const rawType = String(req.params.type || '').toLowerCase();
  const type = rawType === 'webseries' ? 'tv' : rawType;
  if (!['movie', 'tv'].includes(type)) {
    throw ApiError.badRequest('Invalid title type');
  }

  const rawParam = decodeURIComponent(String(req.params.tmdbId || req.params.id || '')).trim();
  if (!rawParam) {
    throw ApiError.badRequest('Missing title identifier');
  }

  const numId = Number(rawParam);
  if (Number.isInteger(numId) && numId > 0 && /^\d+$/.test(rawParam)) {
    return { type, tmdbId: numId, slug: null, isSlug: false };
  }

  const trailingMatch = rawParam.match(/-(\d{2,10})$/);
  if (trailingMatch) {
    const extracted = Number(trailingMatch[1]);
    if (Number.isInteger(extracted) && extracted > 0) {
      return { type, tmdbId: extracted, slug: rawParam.toLowerCase(), isSlug: false };
    }
  }

  return { type, tmdbId: null, slug: rawParam.toLowerCase(), isSlug: true };
};
