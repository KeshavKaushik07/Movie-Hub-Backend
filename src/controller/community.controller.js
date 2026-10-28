import mongoose from 'mongoose';
import CommunityRoom, { GROUP_SYMBOLS } from '../models/CommunityRoom.js';
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

/**
 * Filter matching strictly top-level posts (excluding replies where `replyTo.messageId` is set)
 */
export const TOP_LEVEL_POST_FILTER = {
  isHidden: { $ne: true },
  $or: [
    { replyTo: { $exists: false } },
    { replyTo: null },
    { 'replyTo.messageId': { $exists: false } },
    { 'replyTo.messageId': null },
  ],
};

/**
 * Recalculates a room's top-level post count (strictly excluding replies) and updates lastMessagePreview.
 */
export const recalculateRoomPostCount = async (roomId) => {
  if (!roomId) return 0;
  const [topLevelCount, latestMsg] = await Promise.all([
    CommunityMessage.countDocuments({
      room: roomId,
      ...TOP_LEVEL_POST_FILTER,
    }),
    CommunityMessage.findOne({ room: roomId, isHidden: { $ne: true } })
      .populate('sender', 'name')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const updateDoc = {
    messageCount: topLevelCount,
    lastMessagePreview: latestMsg
      ? {
          messageId: latestMsg._id,
          senderId: latestMsg.sender?._id || latestMsg.sender || null,
          senderName: latestMsg.sender?.name || 'Member',
          text: String(latestMsg.text || '').slice(0, 120),
          createdAt: latestMsg.createdAt,
        }
      : {
          messageId: null,
          senderId: null,
          senderName: '',
          text: '',
          createdAt: null,
        },
  };
  if (latestMsg?.createdAt) {
    updateDoc.lastMessageAt = latestMsg.createdAt;
  }

  await CommunityRoom.findByIdAndUpdate(roomId, { $set: updateDoc });
  return topLevelCount;
};

const extractIdStr = (val) => {
  if (!val) return null;
  if (typeof val === 'object') return String(val._id || val.id || '');
  return String(val);
};

const isUserRoomAdmin = (room, userId) => {
  if (!room || !userId) return false;
  const uid = String(userId);
  const inAdmins = (room.admins || []).some((a) => extractIdStr(a) === uid);
  const isCreator = room.createdBy && extractIdStr(room.createdBy) === uid;
  return inAdmins || isCreator;
};

const isUserRoomMember = (room, userId) => {
  if (!room || !userId) return false;
  const uid = String(userId);
  if (isUserRoomAdmin(room, uid)) return true;
  return (room.members || []).some((m) => extractIdStr(m) === uid);
};

const isUserBlockedInRoom = (room, userId) => {
  if (!room || !userId) return false;
  const uid = String(userId);
  return (room.blockedUsers || []).some((b) => extractIdStr(b) === uid);
};

const shapeUserRef = (u) => {
  if (!u || typeof u !== 'object' || (!u.name && !u.email)) return null;
  return {
    id: String(u._id || u.id),
    name: u.name || 'User',
    email: u.email || '',
    role: u.role || 'user',
    avatarColor: u.avatarColor || '#f5b942',
    isActive: u.isActive !== false,
  };
};

const shapeRoom = (
  r,
  currentUserId = null,
  topLevelPostCountOverride = undefined,
) => {
  const obj = typeof r.toObject === 'function' ? r.toObject() : r;
  const uid = currentUserId ? String(currentUserId) : null;

  // Deduplicate Admin IDs & populated Admin objects (including creator fallback)
  const adminMap = new Map();
  const adminIdSet = new Set();

  if (Array.isArray(obj.admins)) {
    obj.admins.forEach((a) => {
      const idStr = extractIdStr(a);
      if (idStr) {
        adminIdSet.add(idStr);
        const shaped = shapeUserRef(a);
        if (shaped) adminMap.set(idStr, shaped);
      }
    });
  }
  const creatorIdStr = extractIdStr(obj.createdBy);
  if (creatorIdStr && adminIdSet.size === 0) {
    adminIdSet.add(creatorIdStr);
    const shapedCreator = shapeUserRef(obj.createdBy);
    if (shapedCreator) adminMap.set(creatorIdStr, shapedCreator);
  }

  // Deduplicate Member IDs (every Room Admin is also a member)
  const memberIdSet = new Set(adminIdSet);
  if (Array.isArray(obj.members)) {
    obj.members.forEach((m) => {
      const idStr = extractIdStr(m);
      if (idStr) memberIdSet.add(idStr);
    });
  }

  const blockedIdSet = new Set();
  if (Array.isArray(obj.blockedUsers)) {
    obj.blockedUsers.forEach((b) => {
      const idStr = extractIdStr(b);
      if (idStr) {
        blockedIdSet.add(idStr);
        memberIdSet.delete(idStr);
        adminIdSet.delete(idStr);
      }
    });
  }

  const postsCount =
    topLevelPostCountOverride !== undefined
      ? Number(topLevelPostCountOverride)
      : Math.max(0, Number(obj.messageCount || 0));

  const locked = Boolean(obj.isLocked || obj.isBlocked);

  return {
    id: String(obj._id),
    name: obj.name,
    slug: obj.slug,
    description: obj.description || '',
    icon: obj.icon || '🎬',
    roomType: 'public',
    topic: obj.topic || 'general',
    tmdbId: obj.tmdbId || null,
    mediaType: obj.mediaType || null,
    subType: obj.subType || null,
    coverImage: obj.coverImage || '',
    posterImage: obj.posterImage || '',
    isOfficial: Boolean(obj.isOfficial),
    isLocked: locked,
    isBlocked: locked,
    isActive: obj.isActive !== false,
    slowModeSeconds: obj.slowModeSeconds || 0,
    memberCount: memberIdSet.size,
    memberIds: Array.from(memberIdSet),
    adminIds: Array.from(adminIdSet),
    admins: Array.from(adminMap.values()),
    blockedCount: blockedIdSet.size,
    blockedUserIds: Array.from(blockedIdSet),
    isMember: uid ? memberIdSet.has(uid) : false,
    isRoomAdmin: uid ? adminIdSet.has(uid) : false,
    isBlockedUser: uid ? blockedIdSet.has(uid) : false,
    onlineCount: getRoomOnlineCount(obj._id),
    messageCount: postsCount,
    postsCount,
    lastMessageAt: obj.lastMessageAt,
    lastMessagePreview: obj.lastMessagePreview?.text
      ? obj.lastMessagePreview
      : null,
    createdBy: shapeUserRef(obj.createdBy),
    createdAt: obj.createdAt,
  };
};

const shapeMessage = (m, currentUserId = null) => {
  const obj = typeof m.toObject === 'function' ? m.toObject() : m;
  const likesArr = Array.isArray(obj.likes) ? obj.likes : [];
  const hasReply = Boolean(obj.replyTo && obj.replyTo.messageId);
  return {
    id: String(obj._id),
    roomId: String(obj.room),
    text: String(obj.text || ''),
    spoiler: Boolean(obj.spoiler),
    isPinned: Boolean(obj.isPinned),
    isEdited: Boolean(obj.isEdited),
    isHidden: Boolean(obj.isHidden),
    isReply: hasReply,
    likesCount: likesArr.length,
    liked: currentUserId
      ? likesArr.some((id) => String(id) === String(currentUserId))
      : false,
    replyTo: hasReply
      ? {
          messageId: String(obj.replyTo.messageId),
          senderName: obj.replyTo.senderName || 'Member',
          textSnippet: obj.replyTo.textSnippet || '',
        }
      : null,
    sharedTitle: obj.sharedTitle?.tmdbId ? obj.sharedTitle : null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    sender: obj.sender
      ? {
          id: String(obj.sender._id || obj.sender.id || obj.sender),
          name: obj.sender.name || 'Member',
          avatarColor: obj.sender.avatarColor || '#f5b942',
          role: obj.sender.role || 'user',
        }
      : {
          id: '',
          name: 'Member',
          avatarColor: '#f5b942',
          role: 'user',
        },
  };
};

const findRoomByIdOrSlug = async (roomId) => {
  const query = mongoose.Types.ObjectId.isValid(roomId)
    ? { _id: roomId }
    : { slug: String(roomId).toLowerCase() };
  return CommunityRoom.findOne(query)
    .populate('createdBy', 'name email role avatarColor isActive')
    .populate('admins', 'name email role avatarColor isActive');
};

const assertRoomAccess = (room) => {
  if (!room || !room.isActive) {
    throw ApiError.notFound('Community not found');
  }
};

/**
 * Public: Get Available Group Symbols
 * GET /api/v1/community/symbols
 */
/**
 * Public: List dynamic community room topics from DB + defaults
 * GET /api/v1/community/topics
 */
export const listRoomTopics = asyncHandler(async (_req, res) => {
  const distinctTopics = await CommunityRoom.distinct('topic', { isActive: true });
  const standardTopics = [
    'general',
    'bollywood',
    'hollywood',
    'tollywood',
    'webseries',
    'boxoffice',
    'anime',
    'spoilers',
    'fanclub',
  ];
  const set = new Set(
    [...standardTopics, ...distinctTopics]
      .filter(Boolean)
      .map((t) => String(t).toLowerCase().trim())
  );
  const topics = Array.from(set).filter(Boolean);
  res.json({ success: true, topics });
});

export const listGroupSymbols = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    symbols: GROUP_SYMBOLS,
  });
});

/**
 * Public: List Communities (Strictly Community Chat Groups, with top-level post counts excluding replies)
 * GET /api/v1/community/rooms
 */
export const listPublicRooms = asyncHandler(async (req, res) => {
  const filter = {
    isActive: true,
    roomType: 'public',
  };
  if (req.query.topic && req.query.topic !== 'all') {
    filter.topic = req.query.topic;
  }
  if (req.query.q) {
    const safeQ = String(req.query.q)
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: safeQ, $options: 'i' } },
      { description: { $regex: safeQ, $options: 'i' } },
      { topic: { $regex: safeQ, $options: 'i' } },
    ];
  }

  let rooms = await CommunityRoom.find(filter)
    .populate('createdBy', 'name email role avatarColor isActive')
    .populate('admins', 'name email role avatarColor isActive')
    .sort({ isOfficial: -1, lastMessageAt: -1 })
    .limit(100)
    .lean();

  // Ensure any seeded official community without a creator/admin is assigned to the primary Admin/SuperAdmin
  const unownedRooms = rooms.filter(
    (r) =>
      !r.createdBy &&
      (!r.admins || r.admins.length === 0) &&
      (!r.members || r.members.length === 0),
  );
  if (unownedRooms.length > 0) {
    const primaryAdmin = await User.findOne({
      role: { $in: ['superadmin', 'admin'] },
      isActive: true,
    })
      .select('name email role avatarColor isActive')
      .sort({ role: -1, createdAt: 1 })
      .lean();
    if (primaryAdmin) {
      await CommunityRoom.updateMany(
        { _id: { $in: unownedRooms.map((r) => r._id) } },
        {
          $set: {
            createdBy: primaryAdmin._id,
            admins: [primaryAdmin._id],
            members: [primaryAdmin._id],
            memberCount: 1,
          },
        },
      );
      rooms = rooms.map((r) =>
        !r.createdBy &&
        (!r.admins || r.admins.length === 0) &&
        (!r.members || r.members.length === 0)
          ? {
              ...r,
              createdBy: primaryAdmin,
              admins: [primaryAdmin],
              members: [primaryAdmin._id],
              memberCount: 1,
            }
          : r,
      );
    }
  }

  // Compute exact top-level posts count (excluding replies!) per community
  const roomIds = rooms.map((r) => r._id);
  const postCountsAgg =
    roomIds.length > 0
      ? await CommunityMessage.aggregate([
          {
            $match: {
              room: { $in: roomIds },
              ...TOP_LEVEL_POST_FILTER,
            },
          },
          {
            $group: {
              _id: '$room',
              count: { $sum: 1 },
            },
          },
        ])
      : [];

  const postCountMap = new Map(
    postCountsAgg.map((item) => [String(item._id), item.count]),
  );

  // Sync any room whose stored messageCount included replies
  const syncOps = [];
  for (const r of rooms) {
    const exactTopPosts = postCountMap.get(String(r._id)) || 0;
    if (r.messageCount !== exactTopPosts) {
      syncOps.push(
        CommunityRoom.updateOne(
          { _id: r._id },
          { $set: { messageCount: exactTopPosts } },
        ),
      );
    }
  }
  if (syncOps.length > 0) {
    Promise.all(syncOps).catch(() => {});
  }

  res.json({
    success: true,
    total: rooms.length,
    symbols: GROUP_SYMBOLS,
    rooms: rooms.map((r) =>
      shapeRoom(r, req.user?._id, postCountMap.get(String(r._id)) || 0),
    ),
  });
});

/**
 * Legacy compatibility endpoint for Details page if invoked
 * POST /api/v1/community/rooms/movie/:type/:tmdbId
 */
export const getOrCreateMovieRoom = asyncHandler(async (req, res) => {
  const { type = 'movie', tmdbId } = req.params;
  const numId = Number(tmdbId);
  if (!Number.isInteger(numId) || numId <= 0) {
    throw ApiError.badRequest('Valid numeric tmdbId is required');
  }
  const normalizedType =
    type === 'webseries' ? 'tv' : type === 'tv' ? 'tv' : 'movie';

  let room = await CommunityRoom.findOne({
    mediaType: normalizedType,
    tmdbId: numId,
  })
    .populate('createdBy', 'name email role avatarColor isActive')
    .populate('admins', 'name email role avatarColor isActive');

  if (!room) {
    const titleDoc = await getOrFetchTitle(normalizedType, numId, {
      details: true,
    });
    if (!titleDoc) throw ApiError.notFound('Title not found');
    const card = shapeTitle(titleDoc);

    room = await CommunityRoom.create({
      name: `${card.title} Community`,
      slug: `community-${normalizedType}-${numId}`,
      description: `Community discussion group for ${card.title}.`,
      icon: normalizedType === 'tv' ? '📺' : '🎬',
      roomType: 'public',
      topic: 'general',
      tmdbId: numId,
      mediaType: normalizedType,
      subType: titleDoc.subType || normalizedType,
      coverImage: card.backdropUrl || '',
      posterImage: card.posterUrl || '',
      createdBy: req.user?._id || null,
      admins: req.user?._id ? [req.user._id] : [],
      members: req.user?._id ? [req.user._id] : [],
      memberCount: req.user?._id ? 1 : 0,
      isOfficial: true,
    });
  }

  const topPosts = await recalculateRoomPostCount(room._id);

  res.json({
    success: true,
    room: shapeRoom(room, req.user?._id, topPosts),
  });
});

/**
 * Protected: Any Logged-In User (or Admin) Can Create a Community and Become Its Admin
 * POST /api/v1/community/rooms
 */
export const createCommunityRoom = asyncHandler(async (req, res) => {
  const {
    name,
    description = '',
    icon = '🎬',
    topic = 'general',
    slowModeSeconds = 0,
  } = req.body;

  const cleanName = String(name || '').trim();
  if (!cleanName) {
    throw ApiError.badRequest('Community name is required');
  }
  if (cleanName.length < 2) {
    throw ApiError.badRequest('Community name must be at least 2 characters');
  }

  const baseSlug =
    cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 75) || 'community';

  const cleanIcon = String(icon || '🎬').trim() || '🎬';
  const cleanTopic = String(topic || 'general').trim().toLowerCase().slice(0, 50) || 'general';
  const isStaff = ['admin', 'superadmin'].includes(req.user.role);

  const room = await CommunityRoom.create({
    name: cleanName.slice(0, 140),
    slug: `${baseSlug}-${Date.now().toString(36).slice(-4)}`,
    description: String(description || '')
      .trim()
      .slice(0, 500),
    icon: cleanIcon,
    roomType: 'public',
    topic: cleanTopic,
    slowModeSeconds: Math.max(0, Math.min(300, Number(slowModeSeconds) || 0)),
    createdBy: req.user._id,
    admins: [req.user._id],
    members: [req.user._id],
    memberCount: 1,
    messageCount: 0,
    isOfficial: isStaff,
  });

  await room.populate([
    { path: 'createdBy', select: 'name email role avatarColor isActive' },
    { path: 'admins', select: 'name email role avatarColor isActive' },
  ]);

  res.status(201).json({
    success: true,
    room: shapeRoom(room, req.user._id, 0),
  });
});

/**
 * Protected: Join a Community (Required before a user can chat in the community)
 * POST /api/v1/community/rooms/:roomId/join
 */
export const joinCommunityRoom = asyncHandler(async (req, res) => {
  const room = await findRoomByIdOrSlug(req.params.roomId);
  assertRoomAccess(room);

  if (isUserBlockedInRoom(room, req.user._id)) {
    throw ApiError.forbidden(
      'You have been blocked from joining this community',
    );
  }

  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  if (
    (room.isLocked || room.isBlocked) &&
    !isStaff &&
    !isUserRoomAdmin(room, req.user._id)
  ) {
    throw ApiError.forbidden(
      'This community is currently blocked by moderators',
    );
  }

  const uid = String(req.user._id);
  const memberSet = new Set(
    (room.members || []).map((m) => extractIdStr(m)).filter(Boolean),
  );
  memberSet.add(uid);

  // If the community has no admins yet, make the first joining user or creator an admin
  const adminSet = new Set(
    (room.admins || []).map((a) => extractIdStr(a)).filter(Boolean),
  );
  if (room.createdBy && extractIdStr(room.createdBy) === uid) {
    adminSet.add(uid);
  }

  room.members = Array.from(memberSet);
  room.admins = Array.from(adminSet);
  room.memberCount = room.members.length;
  await room.save();

  await room.populate([
    { path: 'createdBy', select: 'name email role avatarColor isActive' },
    { path: 'admins', select: 'name email role avatarColor isActive' },
  ]);

  const topPosts = await recalculateRoomPostCount(room._id);
  const shaped = shapeRoom(room, req.user._id, topPosts);
  emitRoomEvent(room._id, 'room_updated', shaped);

  res.json({
    success: true,
    room: shaped,
  });
});

/**
 * Protected: Leave a Community
 * POST /api/v1/community/rooms/:roomId/leave
 */
export const leaveCommunityRoom = asyncHandler(async (req, res) => {
  const room = await findRoomByIdOrSlug(req.params.roomId);
  assertRoomAccess(room);

  const uid = String(req.user._id);
  room.members = (room.members || [])
    .map((m) => extractIdStr(m))
    .filter((id) => id && id !== uid);

  room.admins = (room.admins || [])
    .map((a) => extractIdStr(a))
    .filter((id) => id && id !== uid);

  // If the leaving user was the last admin and other members exist, transfer adminship automatically
  if (room.admins.length === 0 && room.members.length > 0) {
    room.admins = [room.members[0]];
    room.createdBy = room.members[0];
  } else if (room.createdBy && extractIdStr(room.createdBy) === uid) {
    room.createdBy = room.admins[0] || null;
  }

  room.memberCount = room.members.length;
  await room.save();

  await room.populate([
    { path: 'createdBy', select: 'name email role avatarColor isActive' },
    { path: 'admins', select: 'name email role avatarColor isActive' },
  ]);

  const topPosts = await recalculateRoomPostCount(room._id);
  const shaped = shapeRoom(room, req.user._id, topPosts);
  emitRoomEvent(room._id, 'room_updated', shaped);

  res.json({
    success: true,
    room: shaped,
  });
});

/**
 * Public / Protected: Inspect Community Members, Room Admins & Blocked Users (with per-user post counts)
 * GET /api/v1/community/rooms/:roomId/members
 */
export const getRoomMembers = asyncHandler(async (req, res) => {
  const query = mongoose.Types.ObjectId.isValid(req.params.roomId)
    ? { _id: req.params.roomId }
    : { slug: String(req.params.roomId).toLowerCase() };

  const room = await CommunityRoom.findOne(query)
    .populate('createdBy', 'name email role avatarColor isActive createdAt')
    .populate('admins', 'name email role avatarColor isActive createdAt')
    .populate('members', 'name email role avatarColor isActive createdAt')
    .populate('blockedUsers', 'name email role avatarColor isActive createdAt');

  assertRoomAccess(room);

  // If this room was seeded or created by Admin before admins/members arrays were populated, link the creator or primary Admin
  if (
    (!room.members || room.members.length === 0) &&
    (!room.admins || room.admins.length === 0)
  ) {
    const fallbackAdmin =
      room.createdBy ||
      (await User.findOne({
        role: { $in: ['superadmin', 'admin'] },
        isActive: true,
      })
        .select('name email role avatarColor isActive createdAt')
        .sort({ role: -1, createdAt: 1 }));
    if (fallbackAdmin) {
      const adminId = fallbackAdmin._id || fallbackAdmin.id;
      room.createdBy = room.createdBy || adminId;
      room.admins = [adminId];
      room.members = [adminId];
      room.memberCount = 1;
      await room.save();
      await room.populate([
        {
          path: 'createdBy',
          select: 'name email role avatarColor isActive createdAt',
        },
        {
          path: 'admins',
          select: 'name email role avatarColor isActive createdAt',
        },
        {
          path: 'members',
          select: 'name email role avatarColor isActive createdAt',
        },
      ]);
    }
  }

  // Also include any user who has posted in this room so legacy rooms show all active participants
  const [senderDocs, postCountsAgg] = await Promise.all([
    CommunityMessage.distinct('sender', {
      room: room._id,
      isHidden: { $ne: true },
    }),
    CommunityMessage.aggregate([
      { $match: { room: room._id, isHidden: { $ne: true } } },
      {
        $group: {
          _id: '$sender',
          topPosts: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $ifNull: ['$replyTo.messageId', null] }, null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          replies: {
            $sum: {
              $cond: [
                { $ne: [{ $ifNull: ['$replyTo.messageId', null] }, null] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const postStatsByUser = new Map(
    postCountsAgg.map((row) => [
      String(row._id),
      { postsCount: row.topPosts || 0, repliesCount: row.replies || 0 },
    ]),
  );

  const blockedSet = new Set(
    (room.blockedUsers || []).map((u) => extractIdStr(u)).filter(Boolean),
  );
  const adminSet = new Set(
    (room.admins || []).map((u) => extractIdStr(u)).filter(Boolean),
  );
  const creatorId = extractIdStr(room.createdBy);
  if (creatorId && !blockedSet.has(creatorId) && adminSet.size === 0) {
    adminSet.add(creatorId);
  }

  const userMap = new Map();
  const registerUserObj = (u) => {
    if (!u || typeof u !== 'object' || (!u.name && !u.email)) return;
    const idStr = String(u._id || u.id);
    if (blockedSet.has(idStr)) return;
    const stats = postStatsByUser.get(idStr) || {
      postsCount: 0,
      repliesCount: 0,
    };
    userMap.set(idStr, {
      id: idStr,
      name: u.name || 'User',
      email: u.email || '',
      role: u.role || 'user',
      avatarColor: u.avatarColor || '#f5b942',
      isActive: u.isActive !== false,
      isCreator: idStr === creatorId,
      isRoomAdmin: adminSet.has(idStr),
      postsCount: stats.postsCount,
      repliesCount: stats.repliesCount,
      createdAt: u.createdAt,
    });
  };

  if (room.createdBy) registerUserObj(room.createdBy);
  (room.admins || []).forEach(registerUserObj);
  (room.members || []).forEach(registerUserObj);

  // Fetch any poster not yet in room.members so Admin sees 100% of users who participated in this room
  const missingSenderIds = (senderDocs || [])
    .map((id) => String(id))
    .filter((id) => id && !userMap.has(id) && !blockedSet.has(id));

  if (missingSenderIds.length > 0) {
    const extraUsers = await User.find({ _id: { $in: missingSenderIds } })
      .select('name email role avatarColor isActive createdAt')
      .lean();
    extraUsers.forEach(registerUserObj);
  }

  const allMembers = Array.from(userMap.values()).sort((a, b) => {
    if (a.isCreator !== b.isCreator) return a.isCreator ? -1 : 1;
    if (a.isRoomAdmin !== b.isRoomAdmin) return a.isRoomAdmin ? -1 : 1;
    return b.postsCount - a.postsCount;
  });

  const blockedList = (room.blockedUsers || [])
    .filter((u) => u && (u.name || u.email))
    .map((u) => ({
      id: String(u._id || u.id),
      name: u.name || 'User',
      email: u.email || '',
      role: u.role || 'user',
      avatarColor: u.avatarColor || '#f5b942',
      isActive: u.isActive !== false,
    }));

  const topPosts = await recalculateRoomPostCount(room._id);

  res.json({
    success: true,
    room: shapeRoom(room, req.user?._id, topPosts),
    totalMembers: allMembers.length,
    admins: allMembers.filter((m) => m.isRoomAdmin),
    members: allMembers,
    blockedUsers: blockedList,
  });
});

/**
 * Protected (Room Admin or Site Admin): Promote Member to Room Admin OR Transfer Adminship
 * POST /api/v1/community/rooms/:roomId/admins
 * Body: { userId, transfer: Boolean }
 */
export const promoteOrTransferRoomAdmin = asyncHandler(async (req, res) => {
  const { userId, transfer = false } = req.body;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw ApiError.badRequest('Valid target userId is required');
  }

  const room = await findRoomByIdOrSlug(req.params.roomId);
  assertRoomAccess(room);

  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  const callerIsRoomAdmin = isUserRoomAdmin(room, req.user._id);
  if (!isStaff && !callerIsRoomAdmin) {
    throw ApiError.forbidden('Only a Community Admin can manage admin roles');
  }

  const targetUser = await User.findById(userId).select(
    'name email role avatarColor isActive',
  );
  if (!targetUser || !targetUser.isActive) {
    throw ApiError.notFound('Target user not found or inactive');
  }

  const targetUid = String(targetUser._id);
  const callerUid = String(req.user._id);

  // Remove from blockedUsers if present
  room.blockedUsers = (room.blockedUsers || [])
    .map((id) => extractIdStr(id))
    .filter((id) => id && id !== targetUid);

  const memberSet = new Set(
    (room.members || []).map((id) => extractIdStr(id)).filter(Boolean),
  );
  memberSet.add(targetUid);

  const adminSet = new Set(
    (room.admins || []).map((id) => extractIdStr(id)).filter(Boolean),
  );
  if (room.createdBy && adminSet.size === 0) {
    adminSet.add(extractIdStr(room.createdBy));
  }
  adminSet.add(targetUid);

  if (transfer && targetUid !== callerUid) {
    adminSet.delete(callerUid);
    if (room.createdBy && extractIdStr(room.createdBy) === callerUid) {
      room.createdBy = targetUser._id;
    }
  }

  room.members = Array.from(memberSet);
  room.admins = Array.from(adminSet);
  room.memberCount = room.members.length;
  await room.save();

  await room.populate([
    { path: 'createdBy', select: 'name email role avatarColor isActive' },
    { path: 'admins', select: 'name email role avatarColor isActive' },
  ]);

  const topPosts = await recalculateRoomPostCount(room._id);
  const shaped = shapeRoom(room, req.user._id, topPosts);
  emitRoomEvent(room._id, 'room_updated', shaped);

  res.json({
    success: true,
    room: shaped,
  });
});

/**
 * Protected (Room Admin or Site Admin): Remove / Demote a Room Admin
 * DELETE /api/v1/community/rooms/:roomId/admins/:targetUserId
 */
export const removeRoomAdmin = asyncHandler(async (req, res) => {
  const { targetUserId } = req.params;
  const room = await findRoomByIdOrSlug(req.params.roomId);
  assertRoomAccess(room);

  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  const callerIsRoomAdmin = isUserRoomAdmin(room, req.user._id);
  if (!isStaff && !callerIsRoomAdmin) {
    throw ApiError.forbidden('Only a Community Admin can modify admin roles');
  }

  const targetUid = String(targetUserId);
  const adminSet = new Set(
    (room.admins || []).map((id) => extractIdStr(id)).filter(Boolean),
  );
  if (room.createdBy && adminSet.size === 0) {
    adminSet.add(extractIdStr(room.createdBy));
  }

  if (adminSet.has(targetUid) && adminSet.size <= 1 && !isStaff) {
    throw ApiError.badRequest(
      'A community must have at least one admin. Promote another member before stepping down.',
    );
  }

  adminSet.delete(targetUid);
  room.admins = Array.from(adminSet);
  if (room.createdBy && extractIdStr(room.createdBy) === targetUid) {
    room.createdBy = room.admins[0] || null;
  }

  await room.save();
  await room.populate([
    { path: 'createdBy', select: 'name email role avatarColor isActive' },
    { path: 'admins', select: 'name email role avatarColor isActive' },
  ]);

  const topPosts = await recalculateRoomPostCount(room._id);
  const shaped = shapeRoom(room, req.user._id, topPosts);
  emitRoomEvent(room._id, 'room_updated', shaped);

  res.json({
    success: true,
    room: shaped,
  });
});

/**
 * Protected (Site Admin or Room Admin):
 * Block a User or Room Admin from a Community AND Completely Delete All of Their Posts!
 * POST /api/v1/community/rooms/:roomId/block-user
 * Body: { userId }
 */
export const blockUserInRoom = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw ApiError.badRequest('Valid userId is required to block a user');
  }

  const room = await findRoomByIdOrSlug(req.params.roomId);
  assertRoomAccess(room);

  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  const callerIsRoomAdmin = isUserRoomAdmin(room, req.user._id);
  if (!isStaff && !callerIsRoomAdmin) {
    throw ApiError.forbidden(
      'You do not have permission to block users in this community',
    );
  }

  const targetUser = await User.findById(userId).select('name email role');
  if (!targetUser) {
    throw ApiError.notFound('User not found');
  }
  if (targetUser.role === 'superadmin') {
    throw ApiError.forbidden('SuperAdmin cannot be blocked');
  }
  if (!isStaff && isUserRoomAdmin(room, userId)) {
    throw ApiError.forbidden(
      'Only Site Admin can block another Community Admin',
    );
  }

  const targetUid = String(targetUser._id);

  // 1. Remove from room members & room admins, and add to blockedUsers
  room.members = (room.members || [])
    .map((id) => extractIdStr(id))
    .filter((id) => id && id !== targetUid);

  room.admins = (room.admins || [])
    .map((id) => extractIdStr(id))
    .filter((id) => id && id !== targetUid);

  if (room.createdBy && extractIdStr(room.createdBy) === targetUid) {
    room.createdBy = room.admins[0] || room.members[0] || null;
    if (room.createdBy && room.admins.length === 0) {
      room.admins = [room.createdBy];
    }
  }

  const blockedSet = new Set(
    (room.blockedUsers || []).map((id) => extractIdStr(id)).filter(Boolean),
  );
  blockedSet.add(targetUid);
  room.blockedUsers = Array.from(blockedSet);
  room.memberCount = room.members.length;
  await room.save();

  // 2. Completely delete all posts and replies by this user!
  // If Site Admin blocks a user/room admin, delete all their posts in this room (and replies to their posts)
  const userMsgsInRoom = await CommunityMessage.find({
    room: room._id,
    sender: targetUser._id,
  })
    .select('_id')
    .lean();
  const userMsgIds = userMsgsInRoom.map((m) => m._id);

  const deleteResult = await CommunityMessage.deleteMany({
    room: room._id,
    $or: [
      { sender: targetUser._id },
      ...(userMsgIds.length > 0
        ? [{ 'replyTo.messageId': { $in: userMsgIds } }]
        : []),
    ],
  });

  // 3. Recalculate top-level post count (excluding replies)
  const topPosts = await recalculateRoomPostCount(room._id);

  await room.populate([
    { path: 'createdBy', select: 'name email role avatarColor isActive' },
    { path: 'admins', select: 'name email role avatarColor isActive' },
  ]);

  const shaped = shapeRoom(room, req.user._id, topPosts);
  emitRoomEvent(room._id, 'user_blocked', {
    userId: targetUid,
    deletedMessagesCount: deleteResult.deletedCount || 0,
    room: shaped,
  });

  res.json({
    success: true,
    deletedMessagesCount: deleteResult.deletedCount || 0,
    room: shaped,
  });
});

/**
 * Protected (Site Admin or Room Admin): Unblock a User in a Community
 * POST /api/v1/community/rooms/:roomId/unblock-user
 * Body: { userId }
 */
export const unblockUserInRoom = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw ApiError.badRequest('Valid userId is required');
  }

  const room = await findRoomByIdOrSlug(req.params.roomId);
  assertRoomAccess(room);

  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  const callerIsRoomAdmin = isUserRoomAdmin(room, req.user._id);
  if (!isStaff && !callerIsRoomAdmin) {
    throw ApiError.forbidden(
      'You do not have permission to unblock users in this community',
    );
  }

  const targetUid = String(userId);
  room.blockedUsers = (room.blockedUsers || [])
    .map((id) => extractIdStr(id))
    .filter((id) => id && id !== targetUid);

  await room.save();
  await room.populate([
    { path: 'createdBy', select: 'name email role avatarColor isActive' },
    { path: 'admins', select: 'name email role avatarColor isActive' },
  ]);

  const topPosts = await recalculateRoomPostCount(room._id);
  const shaped = shapeRoom(room, req.user._id, topPosts);

  res.json({
    success: true,
    room: shaped,
  });
});

/**
 * Public / Protected: List Messages in a Community Room
 * GET /api/v1/community/rooms/:roomId/messages
 */
export const listRoomMessages = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const room = await findRoomByIdOrSlug(roomId);
  assertRoomAccess(room);

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 60));
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

  const [messages, pinnedDocs, topPostsCount] = await Promise.all([
    CommunityMessage.find(msgFilter)
      .populate('sender', 'name avatarColor role')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    CommunityMessage.find({
      room: room._id,
      isPinned: true,
      isHidden: { $ne: true },
    })
      .populate('sender', 'name avatarColor role')
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean(),
    CommunityMessage.countDocuments({
      room: room._id,
      ...TOP_LEVEL_POST_FILTER,
    }),
  ]);

  if (room.messageCount !== topPostsCount) {
    CommunityRoom.updateOne(
      { _id: room._id },
      { $set: { messageCount: topPostsCount } },
    ).catch(() => {});
  }

  const ordered = messages.reverse().map((m) => shapeMessage(m, req.user?._id));

  res.json({
    success: true,
    room: shapeRoom(room, req.user?._id, topPostsCount),
    pinned: pinnedDocs.map((m) => shapeMessage(m, req.user?._id)),
    messages: ordered,
  });
});

/**
 * Public / Protected: Real-Time Server-Sent Events (SSE) Stream for a Community Room
 * GET /api/v1/community/rooms/:roomId/stream
 */
export const streamRoomEvents = asyncHandler(async (req, res) => {
  const room = await findRoomByIdOrSlug(req.params.roomId);
  assertRoomAccess(room);

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

  sendEvent({
    event: 'connected',
    roomId: String(room._id),
    onlineCount: getRoomOnlineCount(room._id),
  });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/**
 * Protected: Send a Chat Post or Reply in a Community
 * Requires the user to have joined the community (`isUserRoomMember`) and not be blocked.
 * Top-level posts increment `messageCount`; replies (`replyToId`) NEVER increment `messageCount`!
 * POST /api/v1/community/rooms/:roomId/messages
 */
export const sendRoomMessage = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const { text, replyToId, spoiler = false, sharedTitle } = req.body;

  if (!text || !String(text).trim()) {
    throw ApiError.badRequest('Message text cannot be empty');
  }

  const room = await findRoomByIdOrSlug(roomId);
  assertRoomAccess(room);

  if (isUserBlockedInRoom(room, req.user._id)) {
    throw ApiError.forbidden(
      'You have been blocked from posting in this community',
    );
  }

  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  const callerIsRoomAdmin = isUserRoomAdmin(room, req.user._id);

  if ((room.isLocked || room.isBlocked) && !isStaff && !callerIsRoomAdmin) {
    throw ApiError.forbidden(
      'This community is currently locked/blocked by moderators',
    );
  }
  if (
    (room.mutedUsers || []).some(
      (id) => extractIdStr(id) === String(req.user._id),
    ) &&
    !isStaff
  ) {
    throw ApiError.forbidden('You are muted in this community');
  }

  // Requirement a.2: Anyone can join a community, and one can chat ONLY after joining!
  if (!isUserRoomMember(room, req.user._id)) {
    throw ApiError.forbidden(
      'Please join this community first to send messages',
    );
  }

  // Enforce slowModeSeconds if configured on the room
  if (room.slowModeSeconds > 0 && !isStaff && !callerIsRoomAdmin) {
    const lastUserMsg = await CommunityMessage.findOne({
      room: room._id,
      sender: req.user._id,
    })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();
    if (lastUserMsg) {
      const elapsedSec =
        (Date.now() - new Date(lastUserMsg.createdAt).getTime()) / 1000;
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
    const parentMsg = await CommunityMessage.findOne({
      _id: replyToId,
      room: room._id,
    }).populate('sender', 'name');
    if (parentMsg) {
      replyTo = {
        messageId: parentMsg._id,
        senderName: parentMsg.sender?.name || 'Member',
        textSnippet: String(parentMsg.text || '').slice(0, 180),
      };
    }
  }

  // Optional attached Movie/WebSeries card resolution by tmdbId
  let resolvedSharedTitle = undefined;
  if (sharedTitle && sharedTitle.tmdbId) {
    const tType =
      sharedTitle.type === 'webseries' ? 'tv' : sharedTitle.type || 'movie';
    const titleDoc = await getOrFetchTitle(tType, Number(sharedTitle.tmdbId), {
      details: false,
    }).catch(() => null);
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

  // Requirement a.6: Only count top-level posts (NEVER count replies!) in room.messageCount
  const topPostsCount = await recalculateRoomPostCount(room._id);

  const shaped = shapeMessage(msg, req.user._id);
  emitRoomEvent(room._id, 'new_message', shaped);

  res.status(201).json({
    success: true,
    chatMessage: shaped,
    message: shaped,
    postsCount: topPostsCount,
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
 * Protected (Sender, Room Admin, or Site Staff): Edit or Moderate a Chat Message
 * PATCH /api/v1/community/messages/:messageId
 */
export const updateOrModerateMessage = asyncHandler(async (req, res) => {
  const msg = await CommunityMessage.findById(req.params.messageId);
  if (!msg) throw ApiError.notFound('Message not found');

  const room = await CommunityRoom.findById(msg.room);
  const isOwner = String(msg.sender) === String(req.user._id);
  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  const callerIsRoomAdmin = isUserRoomAdmin(room, req.user._id);

  if (!isOwner && !isStaff && !callerIsRoomAdmin) {
    throw ApiError.forbidden(
      'You do not have permission to modify this message',
    );
  }

  // Enforce role hierarchy: regular admin/user cannot modify content posted by superadmin
  const modMsgAuthor = await User.findById(msg.sender).select('role');
  if (modMsgAuthor?.role === 'superadmin' && req.user.role !== 'superadmin' && !isOwner) {
    throw ApiError.forbidden('Cannot moderate or edit content posted by a Super Admin');
  }

  if (isOwner && req.body.text !== undefined) {
    const clean = String(req.body.text).trim();
    if (!clean) throw ApiError.badRequest('Message text cannot be empty');
    msg.text = clean.slice(0, 2000);
    msg.isEdited = true;
  }
  if (req.body.spoiler !== undefined) msg.spoiler = Boolean(req.body.spoiler);

  if (isStaff || callerIsRoomAdmin) {
    if (typeof req.body.isPinned === 'boolean')
      msg.isPinned = req.body.isPinned;
    if (typeof req.body.isHidden === 'boolean')
      msg.isHidden = req.body.isHidden;
  }

  await msg.save();
  await msg.populate('sender', 'name avatarColor role');
  await recalculateRoomPostCount(msg.room);

  const shaped = shapeMessage(msg, req.user._id);
  emitRoomEvent(msg.room, 'message_updated', shaped);

  res.json({
    success: true,
    chatMessage: shaped,
    message: shaped,
  });
});

/**
 * Protected (Sender, Room Admin, or Site Staff): Delete a Chat Message
 * DELETE /api/v1/community/messages/:messageId
 */
export const deleteRoomMessage = asyncHandler(async (req, res) => {
  const msg = await CommunityMessage.findById(req.params.messageId);
  if (!msg) throw ApiError.notFound('Message not found');

  const room = await CommunityRoom.findById(msg.room);
  const isOwner = String(msg.sender) === String(req.user._id);
  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  const callerIsRoomAdmin = isUserRoomAdmin(room, req.user._id);

  if (!isOwner && !isStaff && !callerIsRoomAdmin) {
    throw ApiError.forbidden('You cannot delete this message');
  }

  // Enforce role hierarchy: regular admin/user cannot delete content posted by superadmin
  const msgAuthor = await User.findById(msg.sender).select('role');
  if (msgAuthor?.role === 'superadmin' && req.user.role !== 'superadmin') {
    throw ApiError.forbidden('Cannot delete content posted by a Super Admin');
  }

  const roomId = msg.room;
  const deletedId = String(msg._id);

  // Delete the message and any direct replies to it
  await CommunityMessage.deleteMany({
    room: roomId,
    $or: [{ _id: msg._id }, { 'replyTo.messageId': msg._id }],
  });

  const topPostsCount = await recalculateRoomPostCount(roomId);

  emitRoomEvent(roomId, 'message_deleted', {
    messageId: deletedId,
    postsCount: topPostsCount,
  });
  res.json({
    success: true,
    postsCount: topPostsCount,
    message: 'Chat message deleted',
  });
});

/**
 * Protected (Room Admin or Site Admin):
 * Update Community Settings, Change Symbol (`icon`), or Block/Lock Community
 * PATCH /api/v1/community/rooms/:roomId
 */
export const updateCommunityRoom = asyncHandler(async (req, res) => {
  const room = await findRoomByIdOrSlug(req.params.roomId);
  if (!room) throw ApiError.notFound('Community room not found');

  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  const callerIsRoomAdmin = isUserRoomAdmin(room, req.user._id);
  if (!isStaff && !callerIsRoomAdmin) {
    throw ApiError.forbidden(
      'Only a Community Admin or Site Admin can update this community',
    );
  }

  // Enforce role hierarchy: regular admin/user cannot update room created by superadmin
  const roomCreator = await User.findById(room.createdBy).select('role');
  if (roomCreator?.role === 'superadmin' && req.user.role !== 'superadmin') {
    throw ApiError.forbidden('Cannot modify a community room created by Super Admin');
  }

  const {
    name,
    description,
    icon,
    topic,
    isLocked,
    isBlocked,
    isActive,
    slowModeSeconds,
    muteUserId,
    unmuteUserId,
  } = req.body;

  if (name !== undefined && String(name).trim()) {
    room.name = String(name).trim().slice(0, 140);
  }
  if (description !== undefined) {
    room.description = String(description).trim().slice(0, 500);
  }
  if (icon !== undefined && String(icon).trim()) {
    room.icon = String(icon).trim();
  }
  if (topic !== undefined && String(topic).trim()) {
    room.topic = String(topic).trim();
  }
  if (typeof isLocked === 'boolean') {
    room.isLocked = isLocked;
    room.isBlocked = isLocked;
  }
  if (typeof isBlocked === 'boolean') {
    room.isBlocked = isBlocked;
    room.isLocked = isBlocked;
  }
  if (isStaff && typeof isActive === 'boolean') {
    room.isActive = isActive;
  }
  if (slowModeSeconds !== undefined) {
    room.slowModeSeconds = Math.max(
      0,
      Math.min(300, Number(slowModeSeconds) || 0),
    );
  }

  if (muteUserId && mongoose.Types.ObjectId.isValid(muteUserId)) {
    if (!room.mutedUsers.some((id) => String(id) === String(muteUserId))) {
      room.mutedUsers.push(muteUserId);
    }
  }
  if (unmuteUserId && mongoose.Types.ObjectId.isValid(unmuteUserId)) {
    room.mutedUsers = room.mutedUsers.filter(
      (id) => String(id) !== String(unmuteUserId),
    );
  }

  await room.save();
  await room.populate([
    { path: 'createdBy', select: 'name email role avatarColor isActive' },
    { path: 'admins', select: 'name email role avatarColor isActive' },
  ]);

  const topPosts = await recalculateRoomPostCount(room._id);
  const shaped = shapeRoom(room, req.user._id, topPosts);
  emitRoomEvent(room._id, 'room_updated', shaped);

  res.json({
    success: true,
    room: shaped,
  });
});

/**
 * Protected (Site Admin or Community Room Admin): Delete a Community and All Its Messages
 * DELETE /api/v1/community/rooms/:roomId
 */
export const deleteCommunityRoom = asyncHandler(async (req, res) => {
  const room = await findRoomByIdOrSlug(req.params.roomId);
  if (!room) throw ApiError.notFound('Community room not found');

  const isStaff = ['admin', 'superadmin'].includes(req.user.role);
  const callerIsRoomAdmin = isUserRoomAdmin(room, req.user._id);

  if (!isStaff && !callerIsRoomAdmin) {
    throw ApiError.forbidden(
      'You do not have permission to delete this community',
    );
  }

  // Enforce role hierarchy: regular admin/user cannot delete room created by superadmin
  const delRoomCreator = await User.findById(room.createdBy).select('role');
  if (delRoomCreator?.role === 'superadmin' && req.user.role !== 'superadmin') {
    throw ApiError.forbidden('Cannot delete a community room created by Super Admin');
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
    message: 'Community and all its messages deleted',
  });
});

/**
 * Protected: Search Active Users (used to add co-admins or find members)
 * GET /api/v1/community/users?q=...
 */
export const searchChatUsers = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.query.q) {
    const safeQ = String(req.query.q)
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: safeQ, $options: 'i' } },
      { email: { $regex: safeQ, $options: 'i' } },
    ];
  }

  const users = await User.find(filter)
    .select('name email avatarColor bio role favoriteGenres lastLoginAt')
    .sort({ lastLoginAt: -1 })
    .limit(25)
    .lean();

  res.json({
    success: true,
    users: users.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email || '',
      avatarColor: u.avatarColor,
      bio: u.bio || '',
      role: u.role,
      favoriteGenres: u.favoriteGenres || [],
    })),
  });
});
