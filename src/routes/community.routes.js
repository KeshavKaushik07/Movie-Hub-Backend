import { Router } from 'express';
import {
  listPublicRooms,
  getOrCreateMovieRoom,
  listUserDirectMessages,
  startOrGetDirectMessage,
  searchChatUsers,
  listRoomMessages,
  streamRoomEvents,
  sendRoomMessage,
  toggleMessageLike,
  updateOrModerateMessage,
  deleteRoomMessage,
  createCommunityRoom,
  updateCommunityRoom,
} from '../controller/community.controller.js';
import { protect, optionalAuth, authorize } from '../middleware/auth.middleware.js';

const r = Router();

// Public & Movie Chat Rooms
r.get('/rooms', optionalAuth, listPublicRooms);
r.post('/rooms/movie/:type/:tmdbId', optionalAuth, getOrCreateMovieRoom);
r.post('/rooms', protect, authorize('admin', 'superadmin'), createCommunityRoom);
r.patch('/rooms/:roomId', protect, authorize('admin', 'superadmin'), updateCommunityRoom);

// Room Messages & Real-Time SSE Stream
r.get('/rooms/:roomId/messages', optionalAuth, listRoomMessages);
r.get('/rooms/:roomId/stream', optionalAuth, streamRoomEvents);
r.post('/rooms/:roomId/messages', protect, sendRoomMessage);

// Message Reactions, Edits & Moderation
r.post('/messages/:messageId/like', protect, toggleMessageLike);
r.patch('/messages/:messageId', protect, updateOrModerateMessage);
r.delete('/messages/:messageId', protect, deleteRoomMessage);

// User-to-User Direct Messages (1-on-1 Chat) & User Discovery
r.get('/users', protect, searchChatUsers);
r.get('/dms', protect, listUserDirectMessages);
r.post('/dms/:targetUserId', protect, startOrGetDirectMessage);

export default r;
