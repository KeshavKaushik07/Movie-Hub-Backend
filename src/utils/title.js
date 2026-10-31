import ApiError from './ApiError.js';

export const slugifyTitle = (str = '') =>
  String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const normalizeMediaType = (rawType = '') => {
  const clean = String(rawType || '').toLowerCase().trim();
  if (
    [
      'tv',
      'tv-show',
      'tv-shows',
      'tvshow',
      'tvshows',
      'tv-series',
      'tvseries',
      'webseries',
      'web-series',
      'series',
    ].includes(clean)
  ) {
    return 'tv';
  }
  if (['movie', 'movies', 'film', 'films'].includes(clean)) {
    return 'movie';
  }
  return clean;
};

// Reads /titles/:type/:tmdbId from the URL.
// Supports both explicit TMDB IDs (?byId=true) and title slugs (including numeric titles like "24", "83", "96", "300", "1917", or titles ending in numbers like "super-30", "article-15", "blade-runner-2049").
export const parseTitle = (req) => {
  const rawType = String(req.params.type || '').toLowerCase().trim();
  const type = normalizeMediaType(rawType);
  if (!['movie', 'tv'].includes(type)) {
    throw ApiError.badRequest('Invalid title type');
  }

  const rawParam = decodeURIComponent(String(req.params.tmdbId || req.params.id || '')).trim();
  if (!rawParam) {
    throw ApiError.badRequest('Missing title identifier');
  }

  const bySlug = req.query?.bySlug === 'true';
  const byId = req.query?.byId === 'true';

  const numId = Number(rawParam);
  if (!bySlug && Number.isInteger(numId) && numId > 0 && /^\d+$/.test(rawParam)) {
    return {
      type,
      tmdbId: numId,
      slug: rawParam.toLowerCase(),
      isSlug: false,
      explicitById: byId,
    };
  }

  return {
    type,
    tmdbId: null,
    slug: rawParam.toLowerCase(),
    isSlug: true,
    explicitById: false,
  };
};
