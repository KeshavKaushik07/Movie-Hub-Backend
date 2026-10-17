export const API_PREFIX = '/api/v1';

export const ROLES = Object.freeze({
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  USER: 'user',
});

export const PROVIDERS = Object.freeze({ GOOGLE: 'google', GITHUB: 'github' });

export const COOKIES = Object.freeze({
  ACCESS: 'accessToken',
  REFRESH: 'refreshToken',
  OAUTH_STATE: 'oauthState',
});

export const MEDIA_TYPES = Object.freeze(['movie', 'tv']);
export const SUB_TYPES = Object.freeze(['movie', 'tv', 'webseries']);
export const WATCH_STATUS = Object.freeze(['planned', 'watching', 'completed', 'dropped', 'favorite']);

export const BOX_OFFICE_VERDICTS = Object.freeze([
  'All-Time Blockbuster',
  'Blockbuster',
  'Super Hit',
  'Hit',
  'Semi-Hit',
  'Above Average',
  'Average',
  'Below Average',
  'Flop',
  'Disaster',
  'TBA',
]);

// "Industry" names the frontend menu uses -> TMDB language codes
export const INDUSTRIES = Object.freeze({
  hollywood: ['en'],
  bollywood: ['hi'],
  tollywood: ['te'],
  kollywood: ['ta'],
  mollywood: ['ml'],
  sandalwood: ['kn'],
  korean: ['ko'],
  japanese: ['ja'],
  chinese: ['zh', 'cn'],
  french: ['fr'],
  spanish: ['es'],
  british: ['en'],
  turkish: ['tr'],
  punjabi: ['pa'],
  marathi: ['mr'],
  bengali: ['bn'],
});

// Major OTT platforms with TMDB watch provider IDs & metadata
export const OTT_PROVIDERS = Object.freeze({
  netflix: { key: 'netflix', id: 8, ids: [8], name: 'Netflix', region: 'IN', badgeColor: '#E50914' },
  prime: { key: 'prime', id: 119, ids: [9, 119], name: 'Amazon Prime Video', region: 'IN', badgeColor: '#00A8E1' },
  hotstar: { key: 'hotstar', id: 122, ids: [122, 337], name: 'Disney+ Hotstar', region: 'IN', badgeColor: '#09143C' },
  jiocinema: { key: 'jiocinema', id: 220, ids: [220], name: 'JioCinema', region: 'IN', badgeColor: '#D9008D' },
  sonyliv: { key: 'sonyliv', id: 237, ids: [237], name: 'SonyLIV', region: 'IN', badgeColor: '#FF5500' },
  zee5: { key: 'zee5', id: 232, ids: [232], name: 'ZEE5', region: 'IN', badgeColor: '#8230C6' },
  apple: { key: 'apple', id: 350, ids: [350], name: 'Apple TV+', region: 'US', badgeColor: '#555555' },
  hulu: { key: 'hulu', id: 15, ids: [15], name: 'Hulu', region: 'US', badgeColor: '#1CE783' },
  max: { key: 'max', id: 1899, ids: [1899, 384], name: 'Max (HBO)', region: 'US', badgeColor: '#002BE7' },
  crunchyroll: { key: 'crunchyroll', id: 283, ids: [283], name: 'Crunchyroll', region: 'US', badgeColor: '#F47521' },
  mxplayer: { key: 'mxplayer', id: 515, ids: [515], name: 'MX Player', region: 'IN', badgeColor: '#007ACC' },
});
