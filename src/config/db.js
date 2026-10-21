import mongoose from 'mongoose';
import env from './env.js';
import { logger } from '../utils/logger.js';

export const connectDB = async () => {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.success('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error:', err.message));
  await mongoose.connect(env.mongoUri);
  logger.success(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
};

export const disconnectDB = () => mongoose.disconnect();
