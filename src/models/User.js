import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import Color from 'color';
import env from '../config/env.js';

const userPreferencesSchema = new mongoose.Schema(
  {
    region: { type: String, enum: ['IN', 'GLOBAL'], default: 'IN' },
    currency: { type: String, enum: ['INR', 'USD'], default: 'INR' },
    industries: {
      type: [String],
      default: ['bollywood', 'tollywood', 'kollywood', 'mollywood', 'sandalwood', 'hollywood'],
    },
    languages: {
      type: [String],
      default: ['hi', 'te', 'ta', 'ml', 'kn', 'en'],
    },
    genres: {
      type: [Number],
      default: [],
    },
    contentTypes: {
      type: [String],
      default: ['movie', 'webseries', 'tv'],
    },
    onboardingCompleted: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 60 },
    email: { type: String, required: [true, 'Email is required'], unique: true, lowercase: true, trim: true },
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
      required: function () {
        return !this.googleId;
      },
    },
    role: { type: String, enum: ['user', 'admin', 'superadmin'], default: 'user' },
    isActive: { type: Boolean, default: true },
    deactivatedReason: { type: String, default: '' },
    googleId: { type: String },
    avatarColor: { type: String },
    bio: { type: String, maxlength: 300, default: '' },
    favoriteGenres: { type: [String], default: [] },
    preferences: {
      type: userPreferencesSchema,
      default: () => ({
        region: 'IN',
        currency: 'INR',
        industries: ['bollywood', 'tollywood', 'kollywood', 'mollywood', 'sandalwood', 'hollywood'],
        languages: ['hi', 'te', 'ta', 'ml', 'kn', 'en'],
        genres: [],
        contentTypes: ['movie', 'webseries', 'tv'],
        onboardingCompleted: false,
      }),
    },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    refreshTokens: { type: [{ tokenHash: String, expiresAt: Date, _id: false }], select: false, default: [] },
  },
  { timestamps: true },
);

userSchema.pre('save', async function () {
  if (this.isNew && !this.avatarColor) {
    this.avatarColor = Color.hsl(Math.floor(Math.random() * 360), 65, 45).hex();
  }
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, env.bcryptRounds);
  }
});

userSchema.methods.comparePassword = function (typed) {
  if (!this.password) return false;
  return bcrypt.compare(typed, this.password);
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    ['_id', '__v', 'password', 'loginAttempts', 'lockUntil', 'refreshTokens', 'googleId'].forEach((k) => delete ret[k]);
    return ret;
  },
});

export default mongoose.model('User', userSchema);
