import mongoose from 'mongoose';

const genreSchema = new mongoose.Schema({
  tmdbId: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  mediaTypes: [String],
});

export default mongoose.model('Genre', genreSchema);
