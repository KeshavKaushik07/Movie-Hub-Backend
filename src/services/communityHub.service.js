import { EventEmitter } from 'events';
import CommunityRoom from '../models/CommunityRoom.js';
import logger from '../utils/logger.js';

/**
 * In-Memory Real-Time Chat Event Bus (Server-Sent Events / SSE)
 * Allows zero-dependency real-time message broadcasting across connected clients
 * in public community lounges, movie chat rooms, and 1-on-1 user DMs.
 */
const chatBus = new EventEmitter();
chatBus.setMaxListeners(1000);

// Track active SSE connections per room for live "onlineCount" metrics
const activeRoomListeners = new Map();

export const subscribeToRoom = (roomId, listener) => {
  const key = String(roomId);
  const channel = `room:${key}`;
  chatBus.on(channel, listener);
  activeRoomListeners.set(key, (activeRoomListeners.get(key) || 0) + 1);

  return () => {
    chatBus.off(channel, listener);
    const next = Math.max(0, (activeRoomListeners.get(key) || 1) - 1);
    if (next === 0) activeRoomListeners.delete(key);
    else activeRoomListeners.set(key, next);
  };
};

export const emitRoomEvent = (roomId, eventType, payload) => {
  const key = String(roomId);
  chatBus.emit(`room:${key}`, {
    event: eventType,
    roomId: key,
    timestamp: new Date().toISOString(),
    data: payload,
  });
};

export const getRoomOnlineCount = (roomId) => activeRoomListeners.get(String(roomId)) || 0;

const DEFAULT_ROOMS = [
  {
    name: 'General Cinema Lounge',
    slug: 'general-cinema-lounge',
    description: 'Live chat for movie lovers — discuss what you are watching tonight, recommendations, and hidden gems.',
    icon: '🎬',
    roomType: 'public',
    topic: 'general',
    isOfficial: true,
  },
  {
    name: 'Bollywood & Indian Cinema',
    slug: 'bollywood-indian-cinema',
    description: 'Discuss Hindi, Telugu, Tamil, Malayalam, and Kannada releases, songs, trailers, and star cast updates.',
    icon: '🇮🇳',
    roomType: 'public',
    topic: 'bollywood',
    isOfficial: true,
  },
  {
    name: 'Hollywood & Sci-Fi Club',
    slug: 'hollywood-scifi-club',
    description: 'Blockbusters, Christopher Nolan theories, Marvel/DC, Oscars, IMAX releases, and mind-bending thrillers.',
    icon: '🍿',
    roomType: 'public',
    topic: 'hollywood',
    isOfficial: true,
  },
  {
    name: 'Web Series & OTT Binge',
    slug: 'web-series-ott-binge',
    description: 'Netflix, Prime Video, Hotstar, JioCinema, SonyLIV & Apple TV+ originals, finales, and new season drops.',
    icon: '📺',
    roomType: 'public',
    topic: 'webseries',
    isOfficial: true,
  },
  {
    name: 'Box Office & Trade Talk',
    slug: 'box-office-trade-talk',
    description: 'Opening day numbers, worldwide gross collections, budgets, ROI, and trade verdicts.',
    icon: '💰',
    roomType: 'public',
    topic: 'boxoffice',
    isOfficial: true,
  },
  {
    name: 'Anime & K-Drama Lounge',
    slug: 'anime-kdrama-lounge',
    description: 'Dedicated space for Japanese Anime, Korean dramas, thriller series, and OSTs.',
    icon: '🌸',
    roomType: 'public',
    topic: 'anime',
    isOfficial: true,
  },
];

export const seedDefaultCommunityRooms = async () => {
  try {
    for (const room of DEFAULT_ROOMS) {
      await CommunityRoom.findOneAndUpdate(
        { slug: room.slug },
        { $setOnInsert: room },
        { upsert: true, new: true },
      );
    }
    logger.ok(`Community chat rooms ready (${DEFAULT_ROOMS.length} official lounges)`);
  } catch (err) {
    logger.warn('Failed to seed default community rooms:', err.message);
  }
};
