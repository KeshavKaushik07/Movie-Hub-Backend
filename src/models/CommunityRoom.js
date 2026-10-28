import mongoose from 'mongoose';
import { MEDIA_TYPES, SUB_TYPES } from '../config/constant.js';

export const GROUP_SYMBOLS = [
  '🎬',
  '🍿',
  '🎥',
  '🎞️',
  '📽️',
  '🎭',
  '📺',
  '🔥',
  '⭐',
  '🌟',
  '💎',
  '🏆',
  '👑',
  '🚀',
  '💬',
  '🗣️',
  '📢',
  '🎧',
  '🎵',
  '🎸',
  '🕹️',
  '👾',
  '🦸',
  '🦹',
  '🕵️',
  '👻',
  '👽',
  '🤖',
  '🐉',
  '⚔️',
  '🛡️',
  '🇮🇳',
  '🌍',
  '🌸',
  '⛩️',
  '💰',
  '📈',
  '❤️',
  '⚡',
  '🌙',
];

/**
 * Community Chat Room Schema
 * Supports user-created and admin-created communities with:
 * - Multiple transferable Group Admins (`admins`)
 * - Explicit Community Membership (`members`) required before chatting
 * - Blocked users list (`blockedUsers`) and Community Lock/Block status (`isLocked`, `isBlocked`)
 * - Top-level posts counter (`messageCount`, excluding replies)
 */
const communityRoomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 140 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    icon: { type: String, trim: true, default: '🎬' },

    roomType: {
      type: String,
      enum: ['public', 'movie', 'dm'],
      default: 'public',
      index: true,
    },
    topic: {
      type: String,
      trim: true,
      lowercase: true,
      default: 'general',
      index: true,
    },

    // Optional link to a specific Movie / TV Show / Web Series
    tmdbId: { type: Number, default: null, index: true },
    mediaType: { type: String, enum: [...MEDIA_TYPES, null], default: null },
    subType: { type: String, enum: [...SUB_TYPES, null], default: null },
    coverImage: { type: String, trim: true, default: '' },
    posterImage: { type: String, trim: true, default: '' },

    // Legacy 1-on-1 fields kept only for schema compatibility
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    dmKey: { type: String, default: null, index: true },

    // Group Admins (multiple allowed, transferable) & Community Members
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    memberCount: { type: Number, default: 0 },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    mutedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    isOfficial: { type: Boolean, default: false },
    isLocked: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    slowModeSeconds: { type: Number, default: 0, min: 0, max: 300 },

    // Denormalized top-level posts count (replies excluded) & last message preview
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
