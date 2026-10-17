import mongoose from 'mongoose';
import { MEDIA_TYPES, SUB_TYPES } from '../config/constant.js';

/**
 * Featured Hero Carousel Schema
 * Managed exclusively by SuperAdmin.
 * When 1 or more active Featured documents exist, the Home page's Hero Carousel
 * displays ONLY these SuperAdmin-selected movies/web-series/TV shows in exact `order`.
 */
const featuredSchema = new mongoose.Schema(
  {
    tmdbId: { type: Number, required: true, index: true },
    type: { type: String, enum: MEDIA_TYPES, required: true, index: true },
    subType: { type: String, enum: SUB_TYPES, default: 'movie' },
    titleRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Title', default: null },

    // Display priority in Home Hero Carousel (lower number = shown first: 1, 2, 3...)
    order: { type: Number, default: 1, index: true },
    isActive: { type: Boolean, default: true, index: true },

    // Optional editorial overrides for the Hero banner (falls back to Title fields if blank)
    badgeText: { type: String, trim: true, maxlength: 60, default: 'Featured on Movies Hub' },
    customTitle: { type: String, trim: true, maxlength: 200, default: '' },
    customTagline: { type: String, trim: true, maxlength: 300, default: '' },
    customOverview: { type: String, trim: true, maxlength: 1000, default: '' },
    customBackdropUrl: { type: String, trim: true, default: '' },
    customPosterUrl: { type: String, trim: true, default: '' },
    customTrailerKey: { type: String, trim: true, default: '' },

    // Optional scheduling window
    startAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },

    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true },
);

// Prevent duplicate entries for the same movie/series in the Featured carousel
featuredSchema.index({ type: 1, tmdbId: 1 }, { unique: true });
featuredSchema.index({ isActive: 1, order: 1, createdAt: -1 });

export default mongoose.model('Featured', featuredSchema);
