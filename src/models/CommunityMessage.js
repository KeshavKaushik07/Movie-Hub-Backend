import mongoose from 'mongoose';

/**
 * Community & Direct Chat Message Schema
 * Supports real-time SSE + REST chat messages between users in public lounges,
 * movie discussion rooms, and 1-on-1 DMs.
 * Users can attach a Movie/Series recommendation card (`sharedTitle`), reply to
 * another message (`replyTo`), mark spoilers, and react/like messages.
 */
const communityMessageSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CommunityRoom',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    // Optional reply reference to another message in the same room
    replyTo: {
      messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityMessage', default: null },
      senderName: { type: String, trim: true, default: '' },
      textSnippet: { type: String, trim: true, maxlength: 240, default: '' },
    },

    // Optional attached Movie / Web Series card shared inside the chat message
    sharedTitle: {
      tmdbId: { type: Number, default: null },
      type: { type: String, default: '' },
      subType: { type: String, default: '' },
      title: { type: String, default: '' },
      year: { type: Number, default: null },
      posterUrl: { type: String, default: '' },
      backdropUrl: { type: String, default: '' },
      rating: { type: Number, default: 0 },
    },

    spoiler: { type: Boolean, default: false },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isPinned: { type: Boolean, default: false },
    isEdited: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

communityMessageSchema.index({ room: 1, isHidden: 1, createdAt: -1 });
communityMessageSchema.index({ room: 1, isPinned: -1, createdAt: -1 });

export default mongoose.model('CommunityMessage', communityMessageSchema);
