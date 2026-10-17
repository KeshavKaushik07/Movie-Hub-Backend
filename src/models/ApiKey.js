import mongoose from 'mongoose';

const apiKeySchema = new mongoose.Schema(
  {
    label: { type: String, required: [true, 'Label is required'], trim: true, maxlength: 60 },
    provider: { type: String, default: 'tmdb' },
    encryptedKey: { type: String, required: true, select: false },
    keyHash: { type: String, required: true, unique: true, select: false },
    keyPreview: String,
    priority: { type: Number, default: 10 },
    isActive: { type: Boolean, default: true },
    isValid: { type: Boolean, default: true },
    exhaustedUntil: Date,
    requestCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    lastUsedAt: Date,
    lastError: String,
  },
  { timestamps: true },
);

apiKeySchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export default mongoose.model('ApiKey', apiKeySchema);
