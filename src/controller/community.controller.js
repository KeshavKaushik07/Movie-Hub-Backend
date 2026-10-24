import mongoose from 'mongoose';
import CommunityRoom from '../models/CommunityRoom.js';
import CommunityMessage from '../models/CommunityMessage.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { getOrFetchTitle, shapeTitle } from '../services/title.service.js';
import {
  subscribeToRoom,
  emitRoomEvent,
  getRoomOnlineCount,
} from '../services/communityHub.service.js';

const shapeRoom = (r, currentUserId = null) => {
  const obj = typeof r.toObject === 'function' ? r.toObject() : r;
  let displayName = obj.name;
  let dmPeer = null;

  if (obj.roomType === 'dm' && Array.isArray(obj.participants)) {
    const other = obj.participants.find(
      (p) => String(p._id || p.id || p) !== String(currentUserId),
    );
    if (other && other.name) {
      displayName = other.name;
      dmPeer = {
        id: String(other._id || other.id),
        name: other.name,
        avatarColor: other.avatarColor,
        role: other.role,
      };
    }
  }

  return {
    id: String(obj._id),
    name: displayName,
    slug: obj.slug,
    description: obj.description || '',
    icon: obj.icon || '💬',
    roomType: obj.roomType,
    topic: obj.topic || 'general',
    tmdbId: obj.tmdbId || null,
    mediaType: obj.mediaType || null,
    subType: obj.subType || null,
    coverImage: obj.coverImage || '',
    posterImage: obj.posterImage || '',
    isOfficial: Boolean(obj.isOfficial),
    isLocked: Boolean(obj.isLocked),
    isActive: obj.isActive !== false,
    slowModeSeconds: obj.slowModeSeconds || 0,
    memberCount: obj.memberCount || obj.members?.length || 0,
    onlineCount: getRoomOnlineCount(obj._id),
    messageCount: obj.messageCount || 0,
    lastMessageAt: obj.lastMessageAt,
    lastMessagePreview: obj.lastMessagePreview?.text ? obj.lastMessagePreview : null,
    dmPeer,
    createdBy:
      obj.createdBy && typeof obj.createdBy === 'object' && obj.createdBy.name
        ? {
            id: String(obj.createdBy._id || obj.createdBy.id),
            name: obj.createdBy.name,
            email: obj.createdBy.email || '',
            role: obj.createdBy.role || 'admin',
          }
        : null,
    createdAt: obj.createdAt,
  };
};

const shapeMessage = (m, currentUserId = null) => {
  const obj = typeof m.toObject === 'function' ? m.toObject() : m;
  const likesArr = Array.isArray(obj.likes) ? obj.likes : [];
  return {
    id: String(obj._id),
    roomId: String(obj.room),
    text: obj.text,
    spoiler: Boolean(obj.spoiler),
    isPinned: Boolean(obj.isPinned),
    isEdited: Boolean(obj.isEdited),
    isHidden: Boolean(obj.isHidden),
    likesCount: likesArr.length,
    liked: currentUserId ? likesArr.some((id) => String(id) === String(currentUserId)) : false,
    replyTo: obj.replyTo?.messageId ? obj.replyTo : null,
    sharedTitle: obj.sharedTitle?.tmdbId ? obj.sharedTitle : null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    sender: obj.sender
      ? {
          id: String(obj.sender._id || obj.sender.id),
          name: obj.sender.name,
          avatarColor: obj.sender.avatarColor,
          role: obj.sender.role,
        }
      : null,
  };
};

const assertRoomAccess = (room, user) => {
  if (!room || !room.isActive) {
    throw ApiError.notFound('Community chat room not found');
  }
  if (room.roomType === 'dm') {
    if (!user) throw ApiError.unauthorized('Sign in required to access direct messages');
    const isParticipant = (room.participants || []).some(
      (p) => String(p._id || p) === String(user._id),
    );
    const isSuperAdmin = user.role === 'superadmin';
    if (!isParticipant && !isSuperAdmin) {
      throw ApiError.forbidden('You are not a participant in this private conversation');
    }
  }
};

/**
 * Public: List Public & Movie Community Rooms
 * GET /api/v1/community/rooms
 */
export const listPublicRooms = asyncHandler(async (req, res) => {
  const filter = {
    isActive: true,
    roomType: req.query.roomType === 'movie' ? 'movie' : { $in: ['public', 'movie'] },
  };
  if (req.query.topic) filter.topic = req.query.topic;
  if (req.query.q) {
    const safeQ = String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.name = { $regex: safeQ, $options: 'i' };
  }

  const rooms = await CommunityRoom.find(filter)
    .populate('createdBy', 'name email role avatarColor')
    .sort({ isOfficial: -1, lastMessageAt: -1 })
    .limit(60)
    .lean();

  res.json({
    success: true,
    total: rooms.length,
    rooms: rooms.map((r) => shapeRoom(r, req.user?._id)),
  });
});

/**
 * Protected: Get or Auto-Create a Dedicated Movie/Series Discussion Room by (type, tmdbId)
 * POST /api/v1/community/rooms/movie/:type/:tmdbId
 */
export const getOrCreateMovieRoom = asyncHandler(async (req, res) => {
  const { type = 'movie', tmdbId } = req.params;
  const numId = Number(tmdbId);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw ApiError.badRequest('Valid numeric tmdbId is required');
  }
  const normalizedType = type === 'webseries' ? 'tv' : type === 'tv' ? 'tv' : 'movie';

  let room = await CommunityRoom.findOne({
    roomType: 'movie',
    mediaType: normalizedType,
    tmdbId: numId,
  });

  if (!room) {
    const titleDoc = await getOrFetchTitle(normalizedType, numId, { details: true });
    if (!titleDoc) throw ApiError.notFound('Title not found');
    const card = shapeTitle(titleDoc);

    room = await CommunityRoom.create({
      name: `${card.title} (${card.year || 'Chat'})`,
      slug: `movie-${normalizedType}-${numId}`,
      description: `Live fan discussion room for ${card.title}.`,
      icon: normalizedType === 'tv' ? '📺' : '🎬',
      roomType: 'movie',
      topic: 'movie',
      tmdbId: numId,
      mediaType: normalizedType,
      subType: titleDoc.subType || normalizedType,
      coverImage: card.backdropUrl || '',
      posterImage: card.posterUrl || '',
      createdBy: req.user?._id || null,
      isOfficial: true,
    });
  }

  res.json({
    success: true,
    room: shapeRoom(room, req.user?._id),
  });
});

/**
 * Protected: List Current User's 1-on-1 Direct Message Conversations
 * GET /api/v1/community/dms
 */
export const listUserDirectMessages = asyncHandler(async (req, res) => {
  const dms = await CommunityRoom.find({
    roomType: 'dm',
    isActive: true,
    participants: req.user._id,
  })
    .populate('participants', 'name avatarColor role')
    .sort({ lastMessageAt: -1 })
    .limit(50)
    .lean();

  res.json({
    success: true,
    total: dms.length,
    conversations: dms.map((r) => shapeRoom(r, req.user._id)),
  });
});

/**
 * Protected: Start or Open a 1-on-1 Direct Message Room with Another User
 * POST /api/v1/community/dms/:targetUserId
 */
export const startOrGetDirectMessage = asyncHandler(async (req, res) => {
  const { targetUserId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    throw ApiError.badRequest('Invalid target user ID');
  }
  if (String(targetUserId) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot start a direct message with yourself');
  }

  const targetUser = await User.findById(targetUserId).select('name avatarColor role isActive');
  if (!targetUser || !targetUser.isActive) {
    throw ApiError.notFound('Recipient user not found or inactive');
  }

  const sortedPair = [String(req.user._id), String(targetUser._id)].sort();
  const dmKey = `${sortedPair[0]}:${sortedPair[1]}`;

  let room = await CommunityRoom.findOne({ roomType: 'dm', dmKey }).populate(
    'participants',
    'name avatarColor role',
  );

  if (!room) {
    room = await CommunityRoom.create({
      name: `${req.user.name} & ${targetUser.name}`,
      slug: `dm-${sortedPair[0].slice(-6)}-${sortedPair[1].slice(-6)}-${Date.now().toString(36)}`,
      description: 'Private 1-on-1 conversation',
      icon: '✉️',
      roomType: 'dm',
      topic: 'dm',
      participants: [req.user._id, targetUser._id],
      members: [req.user._id, targetUser._id],
      memberCount: 2,
      dmKey,
      createdBy: req.user._id,
    });
    await room.populate('participants', 'name avatarColor role');
  }

  res.json({
    success: true,
    room: shapeRoom(room, req.user._id),
  });
});

/**
 * Protected: Search Active Users to Start a Chat / Direct Message
 * GET /api/v1/community/users?q=...
 */
export const searchChatUsers = asyncHandler(async (req, res) => {
  const filter = { isActive: true, _id: { $ne: req.user._id } };
  if (req.query.q) {
    const safeQ = String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.name = { $regex: safeQ, $options: 'i' };
  }

  const users = await User.find(filter)
    .select('name avatarColor bio role favoriteGenres lastLoginAt')
    .sort({ lastLoginAt: -1 })
    .limit(25)
    .lean();

  res.json({
    success: true,
    users: users.map((u) => ({
      id: String(u._id),
      name: u.name,
      avatarColor: u.avatarColor,
      bio: u.bio || '',
      role: u.role,
      favoriteGenres: u.favoriteGenres || [],
    })),
  });
});

/**
 * Public / Protected: List Messages in a Room (Supports pagination + `after` timestamp for live polling)
 * GET /api/v1/community/rooms/:roomId/messages
 */
export const listRoomMessages = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const query = mongoose.Types.ObjectId.isValid(roomId)
    ? { _id: roomId }
    : { slug: String(roomId).toLowerCase() };

  const room = await CommunityRoom.findOne(query).populate('participants', 'name avatarColor role');
  assertRoomAccess(room, req.user);

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const msgFilter = { room: room._id, isHidden: { $ne: true } };

  if (req.query.after) {
    const afterDate = new Date(req.query.after);
    if (!Number.isNaN(afterDate.getTime())) {
      msgFilter.createdAt = { $gt: afterDate };
    }
  } else if (req.query.before) {
    const beforeDate = new Date(req.query.before);
    if (!Number.isNaN(beforeDate.getTime())) {
      msgFilter.createdAt = { $lt: beforeDate };
    }
  }

  const [messages, pinnedDocs] = await Promise.all([
    CommunityMessage.find(msgFilter)
      .populate('sender', 'name avatarColor role')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    CommunityMessage.find({ room: room._id, isPinned: true, isHidden: { $ne: true } })
      .populate('sender', 'name avatarColor role')
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean(),
  ]);

  // Return messages in chronological order (oldest -> newest) for natural chat scroll
  const ordered = messages.reverse().map((m) => shapeMessage(m, req.user?._id));

  res.json({
    success: true,
    room: shapeRoom(room, req.user?._id),
    pinned: pinnedDocs.map((m) => shapeMessage(m, req.user?._id)),
    messages: ordered,
  });
});

/**
 * Public / Protected: Real-Time Server-Sent Events (SSE) Stream for a Chat Room
 * GET /api/v1/community/rooms/:roomId/stream
 */
export const streamRoomEvents = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const query = mongoose.Types.ObjectId.isValid(roomId)
    ? { _id: roomId }
    : { slug: String(roomId).toLowerCase() };

  const room = await CommunityRoom.findOne(query);
  assertRoomAccess(room, req.user);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (eventPayload) => {
    res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
  };

  const unsubscribe = subscribeToRoom(room._id, sendEvent);

  // Send initial connected confirmation + online count
  sendEvent({
    event: 'connected',
    roomId: String(room._id),
    onlineCount: getRoomOnlineCount(room._id),
  });

  // Keep-alive heartbeat every 25s so proxies don't drop the SSE connection
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/**
 * Protected: Send a Chat Message in a Room (Supports replies & sharing a Movie/Series card by tmdbId)
 * POST /api/v1/community/rooms/:roomId/messages
 */
export const sendRoomMessage = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const { text, replyToId, spoiler = false, sharedTitle } = req.body;

  if (!text || !String(text).trim()) {
    throw ApiError.badRequest('Message text cannot be empty');
  }

  const query = mongoose.Types.ObjectId.isValid(roomId)
    ? { _id: roomId }
    : { slug: String(roomId).toLowerCase() };

  const room = await CommunityRoom.findOne(query);
  assertRoomAccess(room, req.user);

  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  if (room.isLocked && !isStaff) {
    throw ApiError.forbidden('This chat room is currently locked by moderators');
  }
  if ((room.mutedUsers || []).some((id) => String(id) === String(req.user._id)) && !isStaff) {
    throw ApiError.forbidden('You are muted in this chat room');
  }

  // Enforce slowModeSeconds if configured on the room
  if (room.slowModeSeconds > 0 && !isStaff) {
    const lastUserMsg = await CommunityMessage.findOne({
      room: room._id,
      sender: req.user._id,
    })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();
    if (lastUserMsg) {
      const elapsedSec = (Date.now() - new Date(lastUserMsg.createdAt).getTime()) / 1000;
      if (elapsedSec < room.slowModeSeconds) {
        throw ApiError.tooMany(
          `Slow mode is active. Please wait ${Math.ceil(room.slowModeSeconds - elapsedSec)}s before sending another message.`,
        );
      }
    }
  }

  // Optional reply quote resolution
  let replyTo = undefined;
  if (replyToId && mongoose.Types.ObjectId.isValid(replyToId)) {
    const parentMsg = await CommunityMessage.findOne({ _id: replyToId, room: room._id }).populate(
      'sender',
      'name',
    );
    if (parentMsg) {
      replyTo = {
        messageId: parentMsg._id,
        senderName: parentMsg.sender?.name || 'User',
        textSnippet: String(parentMsg.text).slice(0, 180),
      };
    }
  }

  // Optional attached Movie/WebSeries card resolution by tmdbId
  let resolvedSharedTitle = undefined;
  if (sharedTitle && sharedTitle.tmdbId) {
    const tType = sharedTitle.type === 'webseries' ? 'tv' : sharedTitle.type || 'movie';
    const titleDoc = await getOrFetchTitle(tType, Number(sharedTitle.tmdbId), { details: false }).catch(
      () => null,
    );
    if (titleDoc) {
      const card = shapeTitle(titleDoc);
      resolvedSharedTitle = {
        tmdbId: card.id,
        type: card.type,
        subType: card.subType,
        title: card.title,
        year: card.year,
        posterUrl: card.posterUrl || '',
        backdropUrl: card.backdropUrl || '',
        rating: card.rating || 0,
      };
    }
  }

  const msg = await CommunityMessage.create({
    room: room._id,
    sender: req.user._id,
    text: String(text).trim().slice(0, 2000),
    spoiler: Boolean(spoiler),
    ...(replyTo ? { replyTo } : {}),
    ...(resolvedSharedTitle ? { sharedTitle: resolvedSharedTitle } : {}),
  });

  await msg.populate('sender', 'name avatarColor role');

  // Update room's lastMessageAt, messageCount, and member list
  const memberSet = new Set((room.members || []).map((id) => String(id)));
  memberSet.add(String(req.user._id));
  room.members = Array.from(memberSet);
  room.memberCount = room.members.length;
  room.messageCount = (room.messageCount || 0) + 1;
  room.lastMessageAt = msg.createdAt;
  room.lastMessagePreview = {
    messageId: msg._id,
    senderId: req.user._id,
    senderName: req.user.name,
    text: String(msg.text).slice(0, 120),
    createdAt: msg.createdAt,
  };
  await room.save();

  const shaped = shapeMessage(msg, req.user._id);
  emitRoomEvent(room._id, 'new_message', shaped);

  res.status(201).json({
    success: true,
    message: shaped,
  });
});

/**
 * Protected: Toggle Like / Heart Reaction on a Chat Message
 * POST /api/v1/community/messages/:messageId/like
 */
export const toggleMessageLike = asyncHandler(async (req, res) => {
  const msg = await CommunityMessage.findById(req.params.messageId);
  if (!msg || msg.isHidden) throw ApiError.notFound('Message not found');

  const uid = String(req.user._id);
  const idx = msg.likes.findIndex((id) => String(id) === uid);
  const liked = idx === -1;

  if (liked) msg.likes.push(req.user._id);
  else msg.likes.splice(idx, 1);

  await msg.save();
  emitRoomEvent(msg.room, 'message_liked', {
    messageId: String(msg._id),
    likesCount: msg.likes.length,
  });

  res.json({
    success: true,
    liked,
    likesCount: msg.likes.length,
  });
});

/**
 * Protected (Sender or Staff): Edit or Moderate a Chat Message
 * PATCH /api/v1/community/messages/:messageId
 */
export const updateOrModerateMessage = asyncHandler(async (req, res) => {
  const msg = await CommunityMessage.findById(req.params.messageId);
  if (!msg) throw ApiError.notFound('Message not found');

  const isOwner = String(msg.sender) === String(req.user._id);
  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  if (!isOwner && !isStaff) {
    throw ApiError.forbidden('You do not have permission to modify this message');
  }

  if (isOwner && req.body.text !== undefined) {
    const clean = String(req.body.text).trim();
    if (!clean) throw ApiError.badRequest('Message text cannot be empty');
    msg.text = clean.slice(0, 2000);
    msg.isEdited = true;
  }
  if (req.body.spoiler !== undefined) msg.spoiler = Boolean(req.body.spoiler);

  if (isStaff) {
    if (typeof req.body.isPinned === 'boolean') msg.isPinned = req.body.isPinned;
    if (typeof req.body.isHidden === 'boolean') msg.isHidden = req.body.isHidden;
  }

  await msg.save();
  await msg.populate('sender', 'name avatarColor role');
  const shaped = shapeMessage(msg, req.user._id);

  emitRoomEvent(msg.room, 'message_updated', shaped);
  res.json({
    success: true,
    message: shaped,
  });
});

/**
 * Protected (Sender or Staff): Delete a Chat Message
 * DELETE /api/v1/community/messages/:messageId
 */
export const deleteRoomMessage = asyncHandler(async (req, res) => {
  const msg = await CommunityMessage.findById(req.params.messageId);
  if (!msg) throw ApiError.notFound('Message not found');

  const isOwner = String(msg.sender) === String(req.user._id);
  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  if (!isOwner && !isStaff) {
    throw ApiError.forbidden('You cannot delete this message');
  }

  const roomId = msg.room;
  await msg.deleteOne();
  await CommunityRoom.findByIdAndUpdate(roomId, { $inc: { messageCount: -1 } });

  emitRoomEvent(roomId, 'message_deleted', { messageId: String(msg._id) });
  res.json({
    success: true,
    message: 'Chat message deleted',
  });
});

/**
 * Admin / SuperAdmin: Create or Update a Public Community Room
 * POST /api/v1/community/rooms
 */
export const createCommunityRoom = asyncHandler(async (req, res) => {
  const {
    name,
    description = '',
    icon = '💬',
    topic = 'general',
    tmdbId,
    mediaType,
    slowModeSeconds = 0,
  } = req.body;

  if (!name || !String(name).trim()) {
    throw ApiError.badRequest('Room name is required');
  }

  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  let coverImage = req.body.coverImage || '';
  let posterImage = req.body.posterImage || '';
  if (tmdbId) {
    const titleDoc = await getOrFetchTitle(mediaType || 'movie', Number(tmdbId), { details: false }).catch(
      () => null,
    );
    if (titleDoc) {
      const card = shapeTitle(titleDoc);
      coverImage = coverImage || card.backdropUrl || '';
      posterImage = posterImage || card.posterUrl || '';
    }
  }

  const room = await CommunityRoom.create({
    name: String(name).trim(),
    slug: `${slug}-${Date.now().toString(36).slice(-4)}`,
    description: String(description).trim(),
    icon,
    roomType: tmdbId ? 'movie' : 'public',
    topic,
    tmdbId: tmdbId ? Number(tmdbId) : null,
    mediaType: tmdbId ? mediaType || 'movie' : null,
    coverImage,
    posterImage,
    slowModeSeconds: Number(slowModeSeconds) || 0,
    createdBy: req.user._id,
    isOfficial: true,
  });

  res.status(201).json({
    success: true,
    room: shapeRoom(room, req.user._id),
  });
});

/**
 * Admin / SuperAdmin: Moderate Room Settings (lock/unlock, slowMode, mute/unmute user, active toggle)
 * PATCH /api/v1/community/rooms/:roomId
 */
export const updateCommunityRoom = asyncHandler(async (req, res) => {
  const room = await CommunityRoom.findById(req.params.roomId);
  if (!room) throw ApiError.notFound('Community room not found');

  const { name, description, icon, isLocked, isActive, slowModeSeconds, muteUserId, unmuteUserId } = req.body;
  if (name !== undefined) room.name = String(name).trim();
  if (description !== undefined) room.description = String(description).trim();
  if (icon !== undefined) room.icon = String(icon).trim();
  if (typeof isLocked === 'boolean') room.isLocked = isLocked;
  if (typeof isActive === 'boolean') room.isActive = isActive;
  if (slowModeSeconds !== undefined) room.slowModeSeconds = Math.max(0, Number(slowModeSeconds) || 0);

  if (muteUserId && mongoose.Types.ObjectId.isValid(muteUserId)) {
    if (!room.mutedUsers.some((id) => String(id) === String(muteUserId))) {
      room.mutedUsers.push(muteUserId);
    }
  }
  if (unmuteUserId && mongoose.Types.ObjectId.isValid(unmuteUserId)) {
    room.mutedUsers = room.mutedUsers.filter((id) => String(id) !== String(unmuteUserId));
  }

  await room.save();
  res.json({
    success: true,
    room: shapeRoom(room, req.user._id),
  });
});

/**
 * Admin / SuperAdmin (or DM Participant for DM rooms): Delete a Community / Chat Room and its messages
 * DELETE /api/v1/community/rooms/:roomId
 */
export const deleteCommunityRoom = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const query = mongoose.Types.ObjectId.isValid(roomId)
    ? { _id: roomId }
    : { slug: String(roomId).toLowerCase() };

  const room = await CommunityRoom.findOne(query);
  if (!room) throw ApiError.notFound('Community room not found');

  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  const isCreator = room.createdBy && String(room.createdBy) === String(req.user._id);
  const isDmParticipant =
    room.roomType === 'dm' &&
    (room.participants || []).some((p) => String(p._id || p) === String(req.user._id));

  if (!isStaff && !isCreator && !isDmParticipant) {
    throw ApiError.forbidden('You do not have permission to delete this community chat room');
  }

  const deletedId = String(room._id);
  await Promise.all([
    CommunityMessage.deleteMany({ room: room._id }),
    room.deleteOne(),
  ]);

  emitRoomEvent(deletedId, 'room_deleted', { roomId: deletedId });

  res.json({
    success: true,
    deletedId,
    message: 'Community chat room and all messages deleted',
  });
});
