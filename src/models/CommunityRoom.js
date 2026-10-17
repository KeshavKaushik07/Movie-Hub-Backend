import mongoose from 'mongoose';
import { MEDIA_TYPES, SUB_TYPES } from '../config/constant.js';

/**
 * Community Chat Room & Direct Message Conversation Schema
 * Supports 3 room types in one unified scalable model:
 * 1. `public`: Global topic lounges (e.g., Bollywood Hub, Box Office Club, Sci-Fi & Thriller, Anime & K-Drama)
 * 2. `movie`: Dedicated live discussion room for a specific Movie/TV/WebSeries (`tmdbId` + `mediaType`)
 * 3. `dm`: Private 1-on-1 Direct Message chat between two users (`participants` + unique `dmKey`)
 */
const communityRoomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    icon: { type: String, trim: true, default: '💬' },

    roomType: {
      type: String,
      enum: ['public', 'movie', 'dm'],
      default: 'public',
      index: true,
    },
    topic: {
      type: String,
      enum: ['general', 'bollywood', 'hollywood', 'tollywood', 'webseries', 'boxoffice', 'anime', 'spoilers', 'movie', 'dm'],
      default: 'general',
      index: true,
    },

    // Optional link to a specific Movie / TV Show / Web Series (for `roomType === 'movie'`)
    tmdbId: { type: Number, default: null, index: true },
    mediaType: { type: String, enum: [...MEDIA_TYPES, null], default: null },
    subType: { type: String, enum: [...SUB_TYPES, null], default: null },
    coverImage: { type: String, trim: true, default: '' },
    posterImage: { type: String, trim: true, default: '' },

    // For `roomType === 'dm'` (1-on-1 chat between two users)
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    dmKey: { type: String, default: null, index: true }, // Canonical sorted pair: "<userA_id>:<userB_id>"

    // Membership & Moderation
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    memberCount: { type: Number, default: 0 },
    mutedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    isOfficial: { type: Boolean, default: false },
    isLocked: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    slowModeSeconds: { type: Number, default: 0, min: 0, max: 300 },

    // Denormalized last message preview for fast room-list sorting
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: {
      messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
      senderId: { type: mongoose.Schema.Types.ObjectId, default: null },
      senderName: { type: String, default: '' },
      text: { type: String, default: '' },
      createdAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

communityRoomSchema.index({ roomType: 1, isActive: 1, lastMessageAt: -1 });
communityRoomSchema.index(
  { dmKey: 1 },
  { unique: true, partialFilterExpression: { roomType: 'dm', dmKey: { $type: 'string' } } },
);

export default mongoose.model('CommunityRoom', communityRoomSchema);
