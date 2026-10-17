import mongoose from 'mongoose';
import { MEDIA_TYPES, WATCH_STATUS } from '../config/constant.js';

const watchlistSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tmdbId: { type: Number, required: true },
    type: { type: String, enum: MEDIA_TYPES, required: true },
    status: { type: String, enum: WATCH_STATUS, default: 'planned' },
  },
  { timestamps: true },
);

watchlistSchema.index({ user: 1, tmdbId: 1, type: 1 }, { unique: true });

export default mongoose.model('Watchlist', watchlistSchema);
