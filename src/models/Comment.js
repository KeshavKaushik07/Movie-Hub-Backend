import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tmdbId: { type: Number, required: true },
    type: { type: String, enum: ['movie', 'tv'], required: true },
    text: {
      type: String,
      required: [true, 'Comment cannot be empty'],
      trim: true,
      maxlength: [1000, 'Comment is too long (max 1000)'],
    },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    spoiler: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false },
  },
  { timestamps: true },
);

commentSchema.index({ tmdbId: 1, type: 1, createdAt: 1 });
commentSchema.index({ createdAt: -1 });

export default mongoose.model('Comment', commentSchema);
