import mongoose from 'mongoose';
import { MEDIA_TYPES, SUB_TYPES } from '../config/constant.js';

/**
 * Blog & Editorial Article Schema
 * Managed by Admin & SuperAdmin.
 * Linked to a Movie / TV Show / Web Series via (mediaType, tmdbId).
 * Automatically resolves and stores the movie's high-res backdropUrl, posterUrl,
 * and gallery stills from the Title collection / TMDB when created or updated.
 */
const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 220 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    subtitle: { type: String, trim: true, maxlength: 350, default: '' },
    summary: { type: String, trim: true, maxlength: 800, default: '' },
    content: { type: String, required: true, maxlength: 60000 },

    category: {
      type: String,
      enum: [
        'Editorial',
        'Review',
        'Box Office',
        'News',
        'OTT Release',
        'Interview',
        'Listicle',
        'Explained',
      ],
      default: 'Editorial',
      index: true,
    },
    tags: [{ type: String, lowercase: true, trim: true }],

    // Linked Movie / TV / Web Series reference (used to auto-fetch movie images)
    tmdbId: { type: Number, default: null, index: true },
    mediaType: { type: String, enum: [...MEDIA_TYPES, null], default: 'movie' },
    subType: { type: String, enum: [...SUB_TYPES, null], default: 'movie' },
    titleRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Title', default: null },

    // Auto-populated from the selected movie's TMDB/Title record (or overridden manually)
    coverImage: { type: String, trim: true, default: '' },
    posterImage: { type: String, trim: true, default: '' },
    galleryImages: [{ type: String, trim: true }],

    // Snapshot of the linked movie's metadata for instant card rendering
    linkedTitleSnapshot: {
      tmdbId: { type: Number, default: null },
      type: { type: String, default: '' },
      subType: { type: String, default: '' },
      title: { type: String, default: '' },
      year: { type: Number, default: null },
      rating: { type: Number, default: 0 },
      posterUrl: { type: String, default: '' },
      backdropUrl: { type: String, default: '' },
      trailerUrl: { type: String, default: '' },
      verdict: { type: String, default: '' },
      genres: [{ type: String }],
    },

    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorName: { type: String, trim: true, default: '' },
    authorRole: { type: String, trim: true, default: 'admin' },

    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'published',
      index: true,
    },
    isFeatured: { type: Boolean, default: false, index: true },
    isPinned: { type: Boolean, default: false },
    allowComments: { type: Boolean, default: true },
    readTimeMinutes: { type: Number, default: 3 },

    // Engagement metrics
    viewsCount: { type: Number, default: 0 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    likeCount: { type: Number, default: 0, index: true },
    commentCount: { type: Number, default: 0 },
    publishedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

blogSchema.index({ status: 1, isPinned: -1, publishedAt: -1 });
blogSchema.index({ status: 1, category: 1, publishedAt: -1 });
blogSchema.index({ mediaType: 1, tmdbId: 1, status: 1 });

export default mongoose.model('Blog', blogSchema);
