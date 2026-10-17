import mongoose from 'mongoose';

// Progress of the TMDB 1-Lakh quota-balanced crawler. Lets the crawl resume after a restart.
const crawlJobSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ['idle', 'running', 'done', 'stopped', 'failed', 'capped_at_target'],
      default: 'running',
    },
    currentYear: Number,
    titlesSaved: { type: Number, default: 0 },
    currentStep: String,
    targetCap: { type: Number, default: 100000 },
    startedAt: Date,
    finishedAt: Date,
    lastActivityAt: Date,
    lastError: String,
  },
  { timestamps: true },
);

export default mongoose.model('CrawlJob', crawlJobSchema);
