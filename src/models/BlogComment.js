import mongoose from 'mongoose';

/**
 * Blog Comment & Threaded Reply Schema
 * Supports top-level comments (`parent: null`) and nested replies (`parent: ObjectId`),
 * user likes, spoiler flags, and Admin/SuperAdmin moderation.
 */
const blogCommentSchema = new mongoose.Schema(
  {
    blog: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Blog',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BlogComment',
      default: null,
      index: true,
    },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    spoiler: { type: Boolean, default: false },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isPinned: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false, index: true },
    isEdited: { type: Boolean, default: false },
  },
  { timestamps: true },
);

blogCommentSchema.index({ blog: 1, isHidden: 1, isPinned: -1, createdAt: -1 });

export default mongoose.model('BlogComment', blogCommentSchema);
