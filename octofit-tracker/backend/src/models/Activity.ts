import { Schema, model } from 'mongoose';

const activitySchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  type: { type: String, required: true, enum: ['run', 'cycle', 'strength', 'walk', 'swim', 'yoga', 'other'] },
  minutes: { type: Number, required: true, min: 1 },
  points: { type: Number, required: true, min: 1 },
  occurredAt: { type: Date, required: true, default: Date.now },
});

export const Activity = model('Activity', activitySchema);
