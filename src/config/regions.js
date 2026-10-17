// Film industries the crawler collects separately and tags in `regions`.
export const REGIONS = [
  { key: 'hollywood', name: 'Hollywood', language: 'en', country: 'US' },
  { key: 'bollywood', name: 'Bollywood (Hindi)', language: 'hi', country: 'IN' },
  { key: 'tollywood', name: 'Tollywood (Telugu)', language: 'te', country: 'IN' },
  { key: 'kollywood', name: 'Kollywood (Tamil)', language: 'ta', country: 'IN' },
  { key: 'mollywood', name: 'Mollywood (Malayalam)', language: 'ml', country: 'IN' },
  { key: 'sandalwood', name: 'Sandalwood (Kannada)', language: 'kn', country: 'IN' },
  { key: 'korean', name: 'K-Drama & Korean Cinema', language: 'ko', country: 'KR' },
  { key: 'japanese', name: 'Japanese & Anime', language: 'ja', country: 'JP' },
  { key: 'british', name: 'British', language: 'en', country: 'GB' },
  { key: 'marathi', name: 'Marathi', language: 'mr', country: 'IN' },
  { key: 'bengali', name: 'Bengali (Tollygunge)', language: 'bn' },
  { key: 'punjabi', name: 'Pollywood (Punjabi)', language: 'pa' },
  { key: 'gujarati', name: 'Dhollywood (Gujarati)', language: 'gu', country: 'IN' },
  { key: 'chinese', name: 'Chinese', language: 'zh' },
  { key: 'cantonese', name: 'Hong Kong (Cantonese)', language: 'cn' },
  { key: 'spanish', name: 'Spanish', language: 'es' },
  { key: 'french', name: 'French', language: 'fr' },
  { key: 'turkish', name: 'Turkish', language: 'tr', country: 'TR' },
  { key: 'nollywood', name: 'Nollywood (Nigeria)', language: 'en', country: 'NG' },
  { key: 'pakistani', name: 'Lollywood (Urdu)', language: 'ur' },
];

// OTT Watch Providers crawled specifically for Movies, TV Shows, and Web Series
export const OTT_CRAWL_TARGETS = [
  { key: 'netflix', name: 'Netflix', providerIds: '8', watchRegion: 'IN' },
  { key: 'prime', name: 'Amazon Prime Video', providerIds: '119|9', watchRegion: 'IN' },
  { key: 'hotstar', name: 'Disney+ Hotstar', providerIds: '122|337', watchRegion: 'IN' },
  { key: 'jiocinema', name: 'JioCinema', providerIds: '220', watchRegion: 'IN' },
  { key: 'sonyliv', name: 'SonyLIV', providerIds: '237', watchRegion: 'IN' },
  { key: 'zee5', name: 'ZEE5', providerIds: '232', watchRegion: 'IN' },
  { key: 'apple', name: 'Apple TV+', providerIds: '350', watchRegion: 'US' },
  { key: 'hulu', name: 'Hulu', providerIds: '15', watchRegion: 'US' },
  { key: 'max', name: 'Max (HBO)', providerIds: '1899|384', watchRegion: 'US' },
  { key: 'crunchyroll', name: 'Crunchyroll', providerIds: '283', watchRegion: 'US' },
  { key: 'mxplayer', name: 'MX Player', providerIds: '515', watchRegion: 'IN' },
];
