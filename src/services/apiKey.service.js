import axios from 'axios';
import ApiKey from '../models/ApiKey.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { decrypt, encrypt, sha256 } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

let cache = { loadedAt: 0, keys: [] };
const isUsable = (k) => !k.exhaustedUntil || new Date(k.exhaustedUntil) <= new Date();

const loadKeys = async () => {
  if (Date.now() - cache.loadedAt < 30_000) return cache.keys;
  const docs = await ApiKey.find({ isActive: true, isValid: true }).select('+encryptedKey').sort('priority createdAt');
  cache = {
    loadedAt: Date.now(),
    keys: docs.map((d) => ({
      id: String(d._id),
      value: decrypt(d.encryptedKey),
      exhaustedUntil: d.exhaustedUntil,
    })),
  };
  return cache.keys;
};

export const refreshKeyCache = () => {
  cache.loadedAt = 0;
};

export const pickKey = async (skipIds = new Set()) => {
  const key = (await loadKeys()).find((k) => isUsable(k) && !skipIds.has(k.id));
  if (!key) throw ApiError.unavailable('No working TMDB API key. A superadmin must add or re-activate one.');
  return key;
};

export const currentKeyId = async () => (await loadKeys().catch(() => [])).find(isUsable)?.id || null;

export const recordKeyUse = (id) => {
  ApiKey.updateOne({ _id: id }, { $inc: { requestCount: 1 }, lastUsedAt: new Date() }).catch(() => {});
};

export const recordKeyFailure = async (id, status, message) => {
  const change =
    status === 401
      ? { isValid: false, lastError: message || 'TMDB rejected this key (401)' }
      : {
          exhaustedUntil: new Date(Date.now() + env.tmdb.cooldownMinutes * 60_000),
          lastError: message || 'Rate limit reached (429)',
        };
  await ApiKey.updateOne({ _id: id }, { ...change, $inc: { failureCount: 1 } });
  refreshKeyCache();
  logger.warn(`TMDB key ${id} ${status === 401 ? 'is invalid' : 'hit its limit'} - switching to the next key`);
};

export const checkKey = async (value) => {
  try {
    await axios.get(`${env.tmdb.baseUrl}/configuration`, { params: { api_key: value }, timeout: 10_000 });
    return 'valid';
  } catch (err) {
    if (err.response?.status === 401) return 'invalid';
    if (err.response?.status === 429) return 'rate_limited';
    return 'unreachable';
  }
};

export const createKeyRecord = ({ label, value, priority }) =>
  ApiKey.create({
    label,
    priority,
    encryptedKey: encrypt(value),
    keyHash: sha256(value),
    keyPreview: `${value.slice(0, 4)}…${value.slice(-4)}`,
  });

export const seedApiKeyFromEnv = async () => {
  if (!env.tmdb.seedKey || (await ApiKey.estimatedDocumentCount()) > 0) return;
  await createKeyRecord({ label: 'Default (from .env)', value: env.tmdb.seedKey.trim(), priority: 1 });
  logger.success('TMDB API key from .env saved to the database (manage keys from the superadmin API)');
};
