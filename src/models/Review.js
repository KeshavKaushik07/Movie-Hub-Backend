import mongoose from 'mongoose';

// Supports both User Reviews (reviewType='user', 1 per user per title)
// and Critic Reviews (reviewType='critic', added by Admins/SuperAdmins or synced from critic outlets)
const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tmdbId: { type: Number, required: true },
    type: { type: String, enum: ['movie', 'tv'], required: true },
    reviewType: { type: String, enum: ['user', 'critic'], default: 'user' },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Rating must be 1-10'],
      max: [10, 'Rating must be 1-10'],
    },
    headline: {
      type: String,
      trim: true,
      maxlength: [160, 'Headline is too long (max 160)'],
      default: '',
    },
    text: {
      type: String,
      trim: true,
      maxlength: [4000, 'Review is too long (max 4000)'],
      default: '',
    },
    spoiler: { type: Boolean, default: false },
    // Critic-specific metadata
    criticName: { type: String, trim: true, maxlength: 100, default: '' },
    publication: { type: String, trim: true, maxlength: 120, default: '' },
    externalUrl: { type: String, trim: true, maxlength: 500, default: '' },
    isVerifiedCritic: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);

// Regular user can have 1 user-review per title; critic reviews can be multiple per title
reviewSchema.index(
  { user: 1, tmdbId: 1, type: 1, reviewType: 1 },
  { unique: true, partialFilterExpression: { reviewType: 'user' } },
);
reviewSchema.index({ tmdbId: 1, type: 1, reviewType: 1, createdAt: -1 });
reviewSchema.index({ createdAt: -1 });

export default mongoose.model('Review', reviewSchema);
