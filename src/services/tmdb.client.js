import axios from 'axios';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { pickKey, recordKeyFailure, recordKeyUse } from './apiKey.service.js';

const http = axios.create({ baseURL: env.tmdb.baseUrl, timeout: 15_000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Talks to TMDB using the active key pool. Returns JSON or null on 404.
 * Automatically switches keys on 401 / 429.
 */
export async function tmdbGet(path, params = {}) {
  const failedKeys = new Set();
  for (let attempt = 1; attempt <= 6; attempt++) {
    const key = await pickKey(failedKeys);
    try {
      const { data } = await http.get(path, { params: { ...params, api_key: key.value } });
      recordKeyUse(key.id);
      return data;
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) return null;
      if (status === 401 || status === 429) {
        await recordKeyFailure(key.id, status, err.response?.data?.status_message);
        failedKeys.add(key.id);
        continue;
      }
      await sleep(400 * attempt);
    }
  }
  throw ApiError.unavailable('TMDB is not reachable right now');
}
