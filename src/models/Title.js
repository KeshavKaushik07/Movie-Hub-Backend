import mongoose from 'mongoose';
import { MEDIA_TYPES, SUB_TYPES } from '../config/constant.js';

// One document per Movie, TV Show, or Web Series.
// Unique identity: mediaType ('movie' | 'tv') + tmdbId.
// Supports cache-aside lazy enrichment AND SuperAdmin manual override protection (`lockedFields`).
const titleSchema = new mongoose.Schema(
  {
    tmdbId: { type: Number, required: true },
    mediaType: { type: String, enum: MEDIA_TYPES, required: true },
    subType: { type: String, enum: SUB_TYPES, default: 'movie' }, // 'movie' | 'tv' | 'webseries'
    isWebSeries: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false }, // true if manually created by SuperAdmin

    title: { type: String, required: true, trim: true },
    originalTitle: String,
    tagline: String,
    overview: { type: String, default: '' },
    posterPath: String,
    backdropPath: String,
    customPosterUrl: String,
    customBackdropUrl: String,
    releaseDate: Date,
    year: Number,
    genreIds: [Number],
    originalLanguage: String,
    certification: String,
    voteAverage: { type: Number, default: 0 }, // TMDB rating
    voteCount: { type: Number, default: 0 },
    popularity: { type: Number, default: 0 },
    adult: { type: Boolean, default: false },

    // Categorization & Discovery tags
    regions: { type: [String], default: [] },      // hollywood, bollywood, tollywood, korean, japanese...
    ottProviders: { type: [String], default: [] }, // netflix, prime, hotstar, jiocinema, sonyliv, zee5, apple...
    listTags: { type: [String], default: [] },     // trending, popular, top-rated, now-playing, upcoming

    // Community & Critic scores on Movies Hub
    siteRating: { type: Number, default: 0 },
    siteReviewCount: { type: Number, default: 0 },
    criticRating: { type: Number, default: 0 },
    criticReviewCount: { type: Number, default: 0 },

    // Full details enrichment status
    detailsFetched: { type: Boolean, default: false },
    detailsFailed: { type: Boolean, default: false },
    detailsFetchedAt: Date,

    runtime: Number,
    status: String,
    homepage: String,
    imdbId: String,
    genres: [{ id: Number, name: String, _id: false }],
    countries: [String],
    languages: [String],
    keywords: [String],
    productionCompanies: [{ id: Number, name: String, logoPath: String, country: String, _id: false }],
    networks: [{ id: Number, name: String, logoPath: String, _id: false }],

    // Financials: Budget & Box Office Collection (Editable by SuperAdmin + fetched from TMDB)
    budget: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 }, // Worldwide Box Office Collection
    boxOffice: {
      budgetFormatted: { type: String, default: '' },
      domesticCollection: { type: Number, default: 0 },
      internationalCollection: { type: Number, default: 0 },
      worldwideCollection: { type: Number, default: 0 },
      indiaNetCollection: { type: Number, default: 0 },
      indiaGrossCollection: { type: Number, default: 0 },
      openingWeekend: { type: Number, default: 0 },
      openingDay: { type: Number, default: 0 },
      currency: { type: String, default: 'USD' },
      verdict: { type: String, default: '' }, // Blockbuster, Super Hit, Hit, Average, etc.
      notes: { type: String, default: '' },
    },

    // Trailers, Videos & Movie Songs (YouTube)
    trailerKey: String,
    videos: [
      {
        id: String,
        key: String,
        name: String,
        site: { type: String, default: 'YouTube' },
        type: { type: String, default: 'Trailer' }, // Trailer, Teaser, Clip, Featurette, Behind the Scenes, Song
        official: { type: Boolean, default: true },
        publishedAt: Date,
        _id: false,
      },
    ],
    songs: [
      {
        id: String,
        title: String,
        youtubeKey: String,
        artist: String,
        composer: String,
        lyricist: String,
        duration: String,
        language: String,
        isOfficial: { type: Boolean, default: true },
        _id: false,
      },
    ],
    images: {
      backdrops: { type: [String], default: [] },
      posters: { type: [String], default: [] },
    },

    // Watch Providers (Where to Stream / Rent / Buy)
    watchProviders: {
      link: String,
      flatrate: [{ id: Number, name: String, logoPath: String, _id: false }],
      free: [{ id: Number, name: String, logoPath: String, _id: false }],
      rent: [{ id: Number, name: String, logoPath: String, _id: false }],
      buy: [{ id: Number, name: String, logoPath: String, _id: false }],
    },

    // Cast & Crew
    directors: [String],
    writers: [String],
    producers: [String],
    musicDirectors: [String],
    cast: [{ id: Number, name: String, character: String, profilePath: String, order: Number, _id: false }],
    crew: [{ id: Number, name: String, job: String, department: String, profilePath: String, _id: false }],

    // TV & Web Series Seasons
    numberOfSeasons: Number,
    numberOfEpisodes: Number,
    seasons: [
      {
        seasonNumber: Number,
        name: String,
        episodeCount: Number,
        airDate: String,
        posterPath: String,
        overview: String,
        voteAverage: Number,
        _id: false,
      },
    ],
    seasonsDetails: [
      {
        seasonNumber: Number,
        name: String,
        overview: String,
        airDate: String,
        posterPath: String,
        episodes: [
          {
            episodeNumber: Number,
            name: String,
            overview: String,
            airDate: String,
            runtime: Number,
            stillPath: String,
            voteAverage: Number,
            _id: false,
          },
        ],
        _id: false,
      },
    ],

    // External / TMDB fetched reviews (shown alongside Movies Hub Critic & User reviews)
    tmdbReviews: [
      {
        id: String,
        author: String,
        authorAvatar: String,
        rating: Number,
        content: String,
        url: String,
        createdAt: Date,
        _id: false,
      },
    ],

    // SuperAdmin Override Protection: fields listed here will NOT be overwritten by background TMDB crawls
    lockedFields: { type: [String], default: [] },
    lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastEditedAt: Date,
  },
  { timestamps: true },
);

titleSchema.index({ mediaType: 1, tmdbId: 1 }, { unique: true });
titleSchema.index({ title: 'text', originalTitle: 'text', tagline: 'text' }, { weights: { title: 10, originalTitle: 4, tagline: 2 }, name: 'title_text' });
titleSchema.index({ mediaType: 1, popularity: -1 });
titleSchema.index({ subType: 1, popularity: -1 });
titleSchema.index({ isWebSeries: 1, popularity: -1 });
titleSchema.index({ genreIds: 1, popularity: -1 });
titleSchema.index({ year: 1, popularity: -1 });
titleSchema.index({ originalLanguage: 1, popularity: -1 });
titleSchema.index({ voteAverage: -1, voteCount: -1 });
titleSchema.index({ releaseDate: -1 });
titleSchema.index({ regions: 1, mediaType: 1, popularity: -1 });
titleSchema.index({ ottProviders: 1, mediaType: 1, popularity: -1 });
titleSchema.index({ listTags: 1, mediaType: 1, popularity: -1 });
titleSchema.index({ revenue: -1 });
titleSchema.index({ siteRating: -1, siteReviewCount: -1 });
titleSchema.index({ detailsFetched: 1, detailsFailed: 1, popularity: -1 });

export default mongoose.model('Title', titleSchema);
