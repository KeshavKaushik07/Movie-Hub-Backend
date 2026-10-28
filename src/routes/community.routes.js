import { Router } from 'express';
import {
  listGroupSymbols,
  listPublicRooms,
  getOrCreateMovieRoom,
  createCommunityRoom,
  updateCommunityRoom,
  deleteCommunityRoom,
  joinCommunityRoom,
  leaveCommunityRoom,
  getRoomMembers,
  promoteOrTransferRoomAdmin,
  removeRoomAdmin,
  blockUserInRoom,
  unblockUserInRoom,
  listRoomMessages,
  streamRoomEvents,
  sendRoomMessage,
  toggleMessageLike,
  updateOrModerateMessage,
  deleteRoomMessage,
  searchChatUsers,
} from '../controller/community.controller.js';
import { protect, optionalAuth } from '../middleware/auth.middleware.js';

const r = Router();

// Curated Group Symbols
r.get('/symbols', listGroupSymbols);

// Communities (Any authenticated user can create a community; Room Admins & Site Admins can manage)
r.get('/rooms', optionalAuth, listPublicRooms);
r.post('/rooms', protect, createCommunityRoom);
r.patch('/rooms/:roomId', protect, updateCommunityRoom);
r.delete('/rooms/:roomId', protect, deleteCommunityRoom);

// Community Membership, Multiple/Transferable Room Admins & User Blocking
r.post('/rooms/:roomId/join', protect, joinCommunityRoom);
r.post('/rooms/:roomId/leave', protect, leaveCommunityRoom);
r.get('/rooms/:roomId/members', optionalAuth, getRoomMembers);
r.post('/rooms/:roomId/admins', protect, promoteOrTransferRoomAdmin);
r.delete('/rooms/:roomId/admins/:targetUserId', protect, removeRoomAdmin);
r.post('/rooms/:roomId/block-user', protect, blockUserInRoom);
r.post('/rooms/:roomId/unblock-user', protect, unblockUserInRoom);

// Legacy compatibility route
r.post('/rooms/movie/:type/:tmdbId', optionalAuth, getOrCreateMovieRoom);

// Community Messages & Real-Time SSE Stream
r.get('/rooms/:roomId/messages', optionalAuth, listRoomMessages);
r.get('/rooms/:roomId/stream', optionalAuth, streamRoomEvents);
r.post('/rooms/:roomId/messages', protect, sendRoomMessage);

// Message Reactions, Edits & Moderation
r.post('/messages/:messageId/like', protect, toggleMessageLike);
r.patch('/messages/:messageId', protect, updateOrModerateMessage);
r.delete('/messages/:messageId', protect, deleteRoomMessage);

// User Search (for promoting co-admins or finding community members)
r.get('/users', protect, searchChatUsers);

export default r;
