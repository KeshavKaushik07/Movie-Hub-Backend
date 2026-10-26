import Title from '../models/Title.js';
import Genre from '../models/Genre.js';
import Blog from '../models/Blog.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { INDUSTRIES, OTT_PROVIDERS } from '../config/constant.js';
import { REGIONS } from '../config/regions.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  LISTS,
  findTitles,
  shapeTitle,
  syncPersonCreditsToMongo,
} from '../services/title.service.js';
import { getActiveFeaturedHero } from './featured.controller.js';

const imgUrl = (p, size = 'w500') => {
  if (!p) return null;
  if (String(p).startsWith('http://') || String(p).startsWith('https://'))
    return p;
  return `${env.tmdb.imageBase}/${size}${p}`;
};

const CURATED_CELEBRITIES = {
  IN: [
    {
      id: 35742,
      name: 'Shah Rukh Khan',
      department: 'Acting',
      industry: 'Bollywood',
      knownFor: 'Jawan • Pathaan • Chak De! India',
      profilePath: '/tCEppfUu0g2dM07623sA34w22i3.jpg',
    },
    {
      id: 108210,
      name: 'Allu Arjun',
      department: 'Acting',
      industry: 'Tollywood',
      knownFor: 'Pushpa: The Rise • Ala Vaikunthapurramuloo',
      profilePath: '/7fa3K2a8F9f91C1hI2bYqE4L6nU.jpg',
    },
    {
      id: 85034,
      name: 'Ranbir Kapoor',
      department: 'Acting',
      industry: 'Bollywood',
      knownFor: 'Animal • Barfi! • Rockstar',
      profilePath: '/ymYNHV9luwgyrw17NXHqbOWTQkg.jpg',
    },
    {
      id: 237055,
      name: 'Prabhas',
      department: 'Acting',
      industry: 'Tollywood',
      knownFor: 'Baahubali • Kalki 2898 AD • Salaar',
      profilePath: '/6Su5357322T7nC2g27l7n7f3Z3E.jpg',
    },
    {
      id: 85883,
      name: 'Deepika Padukone',
      department: 'Acting',
      industry: 'Bollywood',
      knownFor: 'Padmaavat • Piku • Kalki 2898 AD',
      profilePath: '/sXg0ec4wR3u20h2I3V2W017O8nS.jpg',
    },
    {
      id: 86220,
      name: 'Manoj Bajpayee',
      department: 'Acting',
      industry: 'Bollywood / OTT',
      knownFor: 'The Family Man • Gangs of Wasseypur',
      profilePath: '/f5D5c2H8r6V02F0eF3B52A0qY8j.jpg',
    },
    {
      id: 91555,
      name: 'Rajinikanth',
      department: 'Acting',
      industry: 'Kollywood',
      knownFor: 'Jailer • Enthiran • Sivaji',
      profilePath: '/c5W8zF4H8L6V2E0R3B52A0qY8j.jpg',
    },
    {
      id: 147023,
      name: 'Alia Bhatt',
      department: 'Acting',
      industry: 'Bollywood',
      knownFor: 'Gangubai Kathiawadi • Raazi • RRR',
      profilePath: '/RBnT3N8M2H8r6V02F0eF3B52A0.jpg',
    },
    {
      id: 148361,
      name: 'Fahadh Faasil',
      department: 'Acting',
      industry: 'Mollywood',
      knownFor: 'Aavesham • Vikram • Kumbalangi Nights',
      profilePath: '/efM8zF4H8L6V2E0R3B52A0qY8j.jpg',
    },
    {
      id: 583940,
      name: 'Samantha Ruth Prabhu',
      department: 'Acting',
      industry: 'Tollywood / OTT',
      knownFor: 'The Family Man • Citadel: Honey Bunny • Eega',
      profilePath: '/sM8zF4H8L6V2E0R3B52A0qY8j.jpg',
    },
    {
      id: 116924,
      name: 'S. S. Rajamouli',
      department: 'Directing',
      industry: 'Tollywood',
      knownFor: 'RRR • Baahubali 2 • Eega',
      profilePath: '/rM8zF4H8L6V2E0R3B52A0qY8j.jpg',
    },
    {
      id: 85675,
      name: 'Aamir Khan',
      department: 'Acting',
      industry: 'Bollywood',
      knownFor: 'Dangal • 3 Idiots • Lagaan',
      profilePath: '/aM8zF4H8L6V2E0R3B52A0qY8j.jpg',
    },
  ],
  GLOBAL: [
    {
      id: 2037,
      name: 'Cillian Murphy',
      department: 'Acting',
      industry: 'Hollywood',
      knownFor: 'Oppenheimer • Peaky Blinders • Inception',
      profilePath: '/dm6V24NjjvjMiCtbMkc8Y2WPm2e.jpg',
    },
    {
      id: 525,
      name: 'Christopher Nolan',
      department: 'Directing',
      industry: 'Hollywood',
      knownFor: 'Oppenheimer • Interstellar • The Dark Knight',
      profilePath: '/xuAIuYSmsUzKlUMBFGVZaWsY3DZ.jpg',
    },
    {
      id: 6193,
      name: 'Leonardo DiCaprio',
      department: 'Acting',
      industry: 'Hollywood',
      knownFor: 'Inception • The Wolf of Wall Street • Shutter Island',
      profilePath: '/wo2hJpn04vbtmh0B9utCFdsQhxM.jpg',
    },
    {
      id: 3223,
      name: 'Robert Downey Jr.',
      department: 'Acting',
      industry: 'Hollywood',
      knownFor: 'Avengers: Endgame • Iron Man • Oppenheimer',
      profilePath: '/5qHNjhtjMD4YWH3UP0rm4tKwxCL.jpg',
    },
    {
      id: 505710,
      name: 'Zendaya',
      department: 'Acting',
      industry: 'Hollywood',
      knownFor: 'Dune: Part Two • Euphoria • Spider-Man',
      profilePath: '/3WdOloHpjtjL96uVOhFRRCcYSwq.jpg',
    },
    {
      id: 1190668,
      name: 'Timothée Chalamet',
      department: 'Acting',
      industry: 'Hollywood',
      knownFor: 'Dune: Part Two • Wonka • Interstellar',
      profilePath: '/BE2sdjpgsa2rNTFa66f7upkaOP.jpg',
    },
    {
      id: 234352,
      name: 'Margot Robbie',
      department: 'Acting',
      industry: 'Hollywood',
      knownFor: 'Barbie • The Wolf of Wall Street • Babylon',
      profilePath: '/euDPyqLnuwaWMHajcU3oZ9uZezR.jpg',
    },
    {
      id: 73249,
      name: 'Lee Jung-jae',
      department: 'Acting',
      industry: 'Korean',
      knownFor: 'Squid Game • Hunt • New World',
      profilePath: '/3h5C2H8r6V02F0eF3B52A0qY8j.jpg',
    },
  ],
};

export const browse = asyncHandler(async (req, res) => {
  const data = await findTitles(req.query);
  res.json({ success: true, ...data });
});

export const search = asyncHandler(async (req, res) => {
  const q = String(req.query.q || req.query.query || '').trim();
  const data = await findTitles({ ...req.query, q });
  res.json({ success: true, ...data });
});

export const lists = asyncHandler(async (req, res) => {
  const { name } = req.params;
  const normalized = String(name).replace('_', '-');
  const query = { ...req.query, limit: req.query.limit || 20 };

  if (normalized === 'community-top') {
    query.sort = 'site_rating';
  } else if (normalized === 'box-office') {
    query.sort = 'revenue';
    query.type = 'movie';
  } else if (normalized === 'webseries') {
    query.type = 'webseries';
  } else if (LISTS[normalized]) {
    const { extra, sort } = LISTS[normalized]();
    const data = await findTitles(query, { extra, sort, listName: normalized });
    return res.json({ success: true, list: normalized, ...data });
  } else {
    query.list = normalized;
  }

  const data = await findTitles(query, { listName: normalized });
  res.json({ success: true, list: normalized, ...data });
});

export const byGenre = asyncHandler(async (req, res) => {
  const data = await findTitles({ ...req.query, genre: req.params.genreId });
  res.json({ success: true, ...data });
});

export const byYear = asyncHandler(async (req, res) => {
  const year = Number(req.params.year);
  if (!Number.isInteger(year) || year < 1870 || year > 2100) {
    throw ApiError.badRequest('Invalid year');
  }
  const data = await findTitles({ ...req.query, year });
  res.json({ success: true, ...data });
});

export const byLanguage = asyncHandler(async (req, res) => {
  if (!/^[a-z]{2,3}$/i.test(req.params.code)) {
    throw ApiError.badRequest('Invalid language code');
  }
  const data = await findTitles({
    ...req.query,
    language: req.params.code.toLowerCase(),
  });
  res.json({ success: true, ...data });
});

export const byIndustry = asyncHandler(async (req, res) => {
  const data = await findTitles({ ...req.query, industry: req.params.name });
  res.json({ success: true, industry: req.params.name, ...data });
});

export const byOtt = asyncHandler(async (req, res) => {
  const data = await findTitles({ ...req.query, ott: req.params.providerKey });
  res.json({ success: true, ott: req.params.providerKey, ...data });
});

/**
 * Helper: Build Regional Celebrity List from MongoDB Cast Aggregations + Curated Icons
 */
const buildRegionalCelebrities = async (region = 'IN') => {
  const isIndia = String(region).toUpperCase() !== 'GLOBAL';
  const regionFilter = isIndia
    ? { originalLanguage: { $in: ['hi', 'te', 'ta', 'ml', 'kn'] } }
    : { originalLanguage: { $in: ['en', 'ko', 'ja', 'es', 'fr'] } };

  const agg = await Title.aggregate([
    { $match: { ...regionFilter, 'cast.0': { $exists: true } } },
    { $sort: { popularity: -1 } },
    { $limit: 120 },
    { $unwind: '$cast' },
    {
      $match: {
        'cast.name': { $exists: true, $ne: '' },
        'cast.order': { $lte: 4 },
      },
    },
    {
      $group: {
        _id: '$cast.name',
        tmdbId: { $first: '$cast.id' },
        profilePath: { $first: '$cast.profilePath' },
        gender: { $first: '$cast.gender' },
        count: { $sum: 1 },
        sampleTitles: { $addToSet: '$title' },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 14 },
  ]).catch(() => []);

  const map = new Map();
  for (const item of agg) {
    map.set(item._id.toLowerCase(), {
      id: item.tmdbId || null,
      name: item._id,
      gender: item.gender || 0,
      department: 'Acting',
      industry: isIndia ? 'Indian Cinema' : 'Global Cinema',
      knownFor: (item.sampleTitles || []).slice(0, 3).join(' • '),
      profileUrl: imgUrl(item.profilePath, 'w342'),
      titlesCount: item.count,
    });
  }

  const fallbackPool = isIndia
    ? CURATED_CELEBRITIES.IN
    : CURATED_CELEBRITIES.GLOBAL;
  for (const c of fallbackPool) {
    if (!map.has(c.name.toLowerCase())) {
      map.set(c.name.toLowerCase(), {
        id: c.id,
        name: c.name,
        department: c.department,
        industry: c.industry,
        knownFor: c.knownFor,
        profileUrl: imgUrl(c.profilePath, 'w342'),
        titlesCount: 12,
      });
    }
  }

  return Array.from(map.values()).slice(0, 14);
};

// GET /discover/celebrities?region=IN|GLOBAL
export const celebrities = asyncHandler(async (req, res) => {
  const region = req.query.region || 'IN';
  const items = await buildRegionalCelebrities(region);
  res.json({
    success: true,
    region: String(region).toUpperCase(),
    celebrities: items,
  });
});

// GET /discover/person?name=...&id=... -> Full Actor / Director Filmography
export const personDetails = asyncHandler(async (req, res) => {
  const rawName = String(req.query.name || req.params.name || '').replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();
  const rawId = Number(req.query.id);

  if (!rawName && !Number.isInteger(rawId)) {
    throw ApiError.badRequest('Actor or director name (or id) is required');
  }

  let personMeta = {
    id: Number.isInteger(rawId) && rawId > 0 ? rawId : null,
    name: rawName || 'Artist',
    profileUrl: null,
    knownForDepartment: 'Acting',
    gender: 0,
    biography: '',
    birthday: null,
    placeOfBirth: '',
  };

  // Sync actor/director credits from TMDB and inject into MongoDB cast/crew
  const synced = await syncPersonCreditsToMongo({
    name: rawName,
    id: personMeta.id,
    fromSearch: false,
  });

  if (synced?.personMeta) {
    personMeta = {
      ...personMeta,
      ...synced.personMeta,
    };
  }

  const targetName = String(personMeta.name || rawName).trim();
  const safeName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactNameRegex = safeName ? new RegExp(`^${safeName}$`, 'i') : null;

  const orClauses = [];
  if (exactNameRegex) {
    orClauses.push(
      { 'cast.name': exactNameRegex },
      { 'crew.name': exactNameRegex },
      { directors: exactNameRegex },
      { writers: exactNameRegex },
      { producers: exactNameRegex },
      { musicDirectors: exactNameRegex },
    );
  }
  if (Number.isInteger(personMeta.id) && personMeta.id > 0) {
    orClauses.push({ 'cast.id': personMeta.id }, { 'crew.id': personMeta.id });
  }
  if (synced?.creditPairs?.length) {
    // Match exact { mediaType, tmdbId } pairs (never bare tmdbId across mismatched mediaTypes)
    orClauses.push(...synced.creditPairs);
  }

  let dbDocs = [];
  if (orClauses.length > 0) {
    dbDocs = await Title.find({ $or: orClauses, adult: { $ne: true } })
      .sort({ popularity: -1, year: -1 })
      .limit(80)
      .lean();
  }

  // Fallback portrait extraction from MongoDB if TMDB was offline
  if (!personMeta.profileUrl) {
    for (const doc of dbDocs) {
      const matchCast = (doc.cast || []).find(
        (c) =>
          (personMeta.id && c.id === personMeta.id) ||
          (targetName &&
            String(c.name || '').toLowerCase() === targetName.toLowerCase()),
      );
      if (matchCast) {
        if (!personMeta.id && matchCast.id) personMeta.id = matchCast.id;
        if (matchCast.name) personMeta.name = matchCast.name;
        if (matchCast.profilePath) {
          personMeta.profileUrl = imgUrl(matchCast.profilePath, 'w500');
          break;
        }
      }
      const matchCrew = (doc.crew || []).find(
        (c) =>
          (personMeta.id && c.id === personMeta.id) ||
          (targetName &&
            String(c.name || '').toLowerCase() === targetName.toLowerCase()),
      );
      if (matchCrew) {
        if (!personMeta.id && matchCrew.id) personMeta.id = matchCrew.id;
        if (matchCrew.name) personMeta.name = matchCrew.name;
        if (matchCrew.profilePath) {
          personMeta.profileUrl = imgUrl(matchCrew.profilePath, 'w500');
          break;
        }
      }
    }
  }

  const shapedItems = dbDocs.map(shapeTitle);
  res.json({
    success: true,
    person: personMeta,
    total: shapedItems.length,
    items: shapedItems,
  });
});

// GET /discover/home?region=IN|GLOBAL&industries=...&genres=...
export const homeFeed = asyncHandler(async (req, res) => {
  const isIndia = String(req.query.region || 'IN').toUpperCase() !== 'GLOBAL';
  const prefIndustries = String(req.query.industries || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const prefGenres = String(req.query.genres || '')
    .split(',')
    .map(Number)
    .filter(Number.isFinite);

  const [
    superAdminFeaturedHero,
    upcomingMovies,
    trendingMovies,
    trendingTv,
    webSeries,
    popularMovies,
    topRated,
    bollywood,
    tollywood,
    kollywood,
    hollywood,
    korean,
    netflixShows,
    primeShows,
    communityTop,
    latestBlogs,
    regionalCelebs,
  ] = await Promise.all([
    getActiveFeaturedHero(),
    findTitles(
      { type: 'movie', list: 'upcoming', limit: 24 },
      { listName: 'upcoming' },
    ),
    findTitles(
      { type: 'movie', list: 'trending', limit: 45 },
      { listName: 'trending' },
    ),
    findTitles(
      { type: 'tv', list: 'trending', limit: 45 },
      { listName: 'trending' },
    ),
    findTitles({ type: 'webseries', limit: 45 }),
    findTitles(
      { type: 'movie', list: 'popular', limit: 45 },
      { listName: 'popular' },
    ),
    findTitles(
      { type: 'movie', list: 'top-rated', limit: 45 },
      { listName: 'top-rated' },
    ),
    findTitles({ type: 'movie', industry: 'bollywood', limit: 40 }),
    findTitles({ type: 'movie', industry: 'tollywood', limit: 40 }),
    findTitles({ type: 'movie', industry: 'kollywood', limit: 40 }),
    findTitles({ type: 'movie', industry: 'hollywood', limit: 45 }),
    findTitles({ industry: 'korean', limit: 36 }),
    findTitles({ ott: 'netflix', limit: 45 }),
    findTitles({ ott: 'prime', limit: 45 }),
    Title.find({ siteReviewCount: { $gt: 0 } })
      .sort({ siteRating: -1, siteReviewCount: -1 })
      .limit(12)
      .lean(),
    Blog.find({ status: 'published' })
      .populate('author', 'name avatarColor role')
      .sort({ isPinned: -1, isFeatured: -1, publishedAt: -1 })
      .limit(6)
      .lean(),
    buildRegionalCelebrities(isIndia ? 'IN' : 'GLOBAL'),
  ]);

  // Personalized row based on user's saved preferences (from onboarding modal or DB profile)
  let personalizedItems = [];
  if (prefIndustries.length || prefGenres.length) {
    const pFilter = { adult: { $ne: true } };
    if (prefIndustries.length) pFilter.regions = { $in: prefIndustries };
    if (prefGenres.length) pFilter.genreIds = { $in: prefGenres };
    const pDocs = await Title.find(pFilter)
      .sort({ popularity: -1, voteAverage: -1 })
      .limit(16)
      .lean();
    personalizedItems = pDocs.map(shapeTitle);
  }

  // Hero Carousel: Strictly SuperAdmin's Featured collection when active items exist; otherwise regional + trending fallback
  const fallbackHero = (
    isIndia
      ? [
          ...bollywood.items.slice(0, 3),
          ...tollywood.items.slice(0, 2),
          ...trendingMovies.items.slice(0, 3),
          ...webSeries.items.slice(0, 2),
        ]
      : [
          ...trendingMovies.items.slice(0, 5),
          ...hollywood.items.slice(0, 3),
          ...webSeries.items.slice(0, 2),
        ]
  ).filter((x) => x.backdropUrl || x.posterUrl);

  const hero =
    superAdminFeaturedHero.length > 0 ? superAdminFeaturedHero : fallbackHero;
  const heroSource =
    superAdminFeaturedHero.length > 0
      ? 'superadmin_featured'
      : 'trending_fallback';

  // Build Top 10 Today & Top 10 This Week (prioritizing regional hits for Indian users vs global for international)
  const poolToday = isIndia
    ? [
        ...bollywood.items.slice(0, 4),
        ...tollywood.items.slice(0, 3),
        ...trendingMovies.items.slice(0, 5),
        ...webSeries.items.slice(0, 3),
      ]
    : [...trendingMovies.items.slice(0, 6), ...popularMovies.items.slice(0, 6)];
  const seenToday = new Set();
  const top10Today = [];
  for (const item of poolToday) {
    const k = `${item.type}:${item.id}`;
    if (!seenToday.has(k)) {
      seenToday.add(k);
      top10Today.push({ ...item, rank: top10Today.length + 1 });
      if (top10Today.length === 10) break;
    }
  }

  const poolWeek = isIndia
    ? [
        ...webSeries.items.slice(0, 4),
        ...bollywood.items.slice(2, 7),
        ...kollywood.items.slice(0, 3),
        ...trendingTv.items.slice(0, 4),
      ]
    : [
        ...trendingTv.items.slice(0, 5),
        ...webSeries.items.slice(0, 5),
        ...hollywood.items.slice(0, 5),
      ];
  const seenWeek = new Set();
  const top10Week = [];
  for (const item of poolWeek) {
    const k = `${item.type}:${item.id}`;
    if (!seenWeek.has(k)) {
      seenWeek.add(k);
      top10Week.push({ ...item, rank: top10Week.length + 1 });
      if (top10Week.length === 10) break;
    }
  }

  // Regional-aware row ordering with explicit `seeAllTo` links for every single carousel
  const rows = isIndia
    ? [
        ...(personalizedItems.length
          ? [
              {
                key: 'for-you',
                title: 'Picked For Your Taste',
                subtitle: 'Based on your saved cinema & genre preferences',
                seeAllTo: `/browse/movie?industry=${prefIndustries[0] || 'bollywood'}`,
                items: personalizedItems,
              },
            ]
          : []),
        {
          key: 'bollywood',
          title: 'Bollywood Blockbusters (Hindi)',
          subtitle: 'Biggest Hindi theatrical releases & crowd favorites',
          seeAllTo: '/browse/movie?industry=bollywood',
          items: bollywood.items,
        },
        {
          key: 'web-series',
          title: 'Trending Web Series & OTT Originals',
          subtitle:
            'Binge-worthy originals on Netflix, Prime Video, Hotstar & JioCinema',
          seeAllTo: '/browse/webseries',
          items: webSeries.items,
        },
        {
          key: 'tollywood',
          title: 'South Indian Powerhouse (Tollywood & Pan-India)',
          subtitle: 'Action spectacles and critically acclaimed Telugu cinema',
          seeAllTo: '/browse/movie?industry=tollywood',
          items: tollywood.items,
        },
        {
          key: 'kollywood',
          title: 'Kollywood & Tamil Spotlight',
          subtitle: 'Top-rated Tamil thrillers and mass entertainers',
          seeAllTo: '/browse/movie?industry=kollywood',
          items: kollywood.items,
        },
        {
          key: 'netflix',
          title: 'Streaming Now on Netflix',
          subtitle: 'Top movies and series trending on Netflix',
          seeAllTo: '/browse/movie?ott=netflix',
          items: netflixShows.items,
        },
        {
          key: 'prime',
          title: 'Prime Video Originals & Hits',
          subtitle: 'Popular titles streaming on Amazon Prime Video',
          seeAllTo: '/browse/movie?ott=prime',
          items: primeShows.items,
        },
        {
          key: 'trending-movies',
          title: 'Global Trending Movies',
          subtitle: 'Worldwide box office & streaming sensations',
          seeAllTo: '/browse/movie?list=trending',
          items: trendingMovies.items,
        },
        {
          key: 'hollywood',
          title: 'Hollywood Blockbusters',
          subtitle: 'IMAX spectacles, sci-fi epics & Oscar contenders',
          seeAllTo: '/browse/movie?industry=hollywood',
          items: hollywood.items,
        },
        {
          key: 'top-rated',
          title: 'All-Time Highest Rated',
          subtitle: 'Critically acclaimed masterpieces across decades',
          seeAllTo: '/browse/movie?list=top-rated',
          items: topRated.items,
        },
        ...(communityTop.length
          ? [
              {
                key: 'community-top',
                title: 'Movies Hub Community Top Rated',
                subtitle: 'Highest rated by verified Movies Hub members',
                seeAllTo: '/browse/movie?list=community-top',
                items: communityTop.map(shapeTitle),
              },
            ]
          : []),
      ]
    : [
        ...(personalizedItems.length
          ? [
              {
                key: 'for-you',
                title: 'Picked For Your Taste',
                subtitle: 'Based on your saved cinema & genre preferences',
                seeAllTo: `/browse/movie?industry=${prefIndustries[0] || 'hollywood'}`,
                items: personalizedItems,
              },
            ]
          : []),
        {
          key: 'trending-movies',
          title: 'Trending Movies Worldwide',
          subtitle: 'Most watched movies around the globe this week',
          seeAllTo: '/browse/movie?list=trending',
          items: trendingMovies.items,
        },
        {
          key: 'hollywood',
          title: 'Hollywood Blockbusters',
          subtitle: 'Studio tentpoles, thrillers & theatrical hits',
          seeAllTo: '/browse/movie?industry=hollywood',
          items: hollywood.items,
        },
        {
          key: 'web-series',
          title: 'Popular Streaming Originals & Web Series',
          subtitle: 'Must-watch series across Netflix, Max, Apple TV+ & Prime',
          seeAllTo: '/browse/webseries',
          items: webSeries.items,
        },
        {
          key: 'trending-tv',
          title: 'Trending TV Shows',
          subtitle: 'Acclaimed drama, sci-fi, and crime television',
          seeAllTo: '/browse/tv?list=trending',
          items: trendingTv.items,
        },
        {
          key: 'netflix',
          title: 'Streaming on Netflix',
          subtitle: 'Top movies and series on Netflix',
          seeAllTo: '/browse/movie?ott=netflix',
          items: netflixShows.items,
        },
        {
          key: 'korean',
          title: 'Korean Cinema & K-Drama Spotlight',
          subtitle: 'Award-winning Korean thrillers and series',
          seeAllTo: '/browse/movie?industry=korean',
          items: korean.items,
        },
        {
          key: 'bollywood',
          title: 'Indian Cinema Spotlight (Bollywood & RRR-Era Hits)',
          subtitle: 'Global Indian crossover blockbusters',
          seeAllTo: '/browse/movie?industry=bollywood',
          items: bollywood.items,
        },
        {
          key: 'top-rated',
          title: 'All-Time Top Rated',
          subtitle: 'Highest-rated cinema classics',
          seeAllTo: '/browse/movie?list=top-rated',
          items: topRated.items,
        },
        ...(communityTop.length
          ? [
              {
                key: 'community-top',
                title: 'Movies Hub Community Top Rated',
                subtitle: 'Highest rated by verified Movies Hub members',
                seeAllTo: '/browse/movie?list=community-top',
                items: communityTop.map(shapeTitle),
              },
            ]
          : []),
      ];

  // Deduplicate across rows so the same title does not repeat across Netflix, Prime, Trending, etc.
  const usedAcrossRows = new Set();
  const deduplicatedRows = [];
  for (const row of rows) {
    const pool = Array.isArray(row.items) ? row.items : [];
    const distinctItems = [];
    const rowSeen = new Set();
    for (const item of pool) {
      if (!item?.id) continue;
      const idKey = `${item.type || 'movie'}:${item.id}`;
      const titleKey = String(item.title || item.name || '')
        .toLowerCase()
        .trim();
      if (rowSeen.has(idKey) || (titleKey && rowSeen.has(titleKey))) continue;
      rowSeen.add(idKey);
      if (titleKey) rowSeen.add(titleKey);
      if (
        !usedAcrossRows.has(idKey) &&
        (!titleKey || !usedAcrossRows.has(titleKey))
      ) {
        distinctItems.push(item);
        usedAcrossRows.add(idKey);
        if (titleKey) usedAcrossRows.add(titleKey);
        if (distinctItems.length >= 16) break;
      }
    }
    if (distinctItems.length > 0) {
      deduplicatedRows.push({ ...row, items: distinctItems });
    }
  }

  res.json({
    success: true,
    region: isIndia ? 'IN' : 'GLOBAL',
    currency: isIndia ? 'INR' : 'USD',
    heroSource,
    hero,
    upcoming: {
      title: 'Upcoming Releases & Theatrical Calendar',
      subtitle: isIndia
        ? 'Most anticipated Indian & global releases coming soon'
        : 'Upcoming theatrical & streaming releases',
      seeAllTo: '/browse/movie?list=upcoming',
      items: upcomingMovies.items,
    },
    top10Today,
    top10Week,
    celebrities: regionalCelebs,
    blogs: latestBlogs.map((b) => ({
      id: String(b._id),
      title: b.title,
      slug: b.slug,
      subtitle: b.subtitle || '',
      summary: b.summary || String(b.content || '').slice(0, 180),
      category: b.category || 'Editorial',
      coverImage: b.coverImage || b.linkedTitleSnapshot?.backdropUrl || '',
      posterImage: b.posterImage || b.linkedTitleSnapshot?.posterUrl || '',
      linkedTitle: b.linkedTitleSnapshot?.tmdbId ? b.linkedTitleSnapshot : null,
      readTimeMinutes: b.readTimeMinutes || 3,
      likeCount: b.likeCount || b.likes?.length || 0,
      commentCount: b.commentCount || 0,
      publishedAt: b.publishedAt || b.createdAt,
      authorName: b.author?.name || b.authorName || 'Movies Hub Editorial',
    })),
    rows: deduplicatedRows,
  });
});

export const genres = asyncHandler(async (req, res) => {
  const filter = ['movie', 'tv'].includes(req.query.type)
    ? { mediaTypes: req.query.type }
    : {};
  const list = (await Genre.find(filter).sort('name').lean()).map((g) => ({
    id: g.tmdbId,
    name: g.name,
    types: g.mediaTypes,
  }));
  res.json({ success: true, genres: list });
});

export const industries = asyncHandler(async (_req, res) => {
  const counts = await Title.aggregate([
    { $unwind: '$regions' },
    { $group: { _id: '$regions', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [c._id, c.count]));

  res.json({
    success: true,
    industries: REGIONS.map((r) => ({
      key: r.key,
      name: r.key,
      label: r.label,
      language: r.language,
      languages: INDUSTRIES[r.key] || [r.language],
      country: r.country,
      codes: INDUSTRIES[r.key] || [r.language],
      count: countMap.get(r.key) || 0,
    })),
  });
});

export const ottProviders = asyncHandler(async (_req, res) => {
  const counts = await Title.aggregate([
    { $unwind: '$ottProviders' },
    { $group: { _id: '$ottProviders', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [c._id, c.count]));

  res.json({
    success: true,
    providers: Object.entries(OTT_PROVIDERS).map(([key, val]) => ({
      key,
      label: val.label,
      ids: val.ids,
      region: val.region,
      count: countMap.get(key) || 0,
    })),
  });
});

export const ottList = ottProviders;
