import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/**
 * Last block the event listener processed, so a restart replays from where it stopped
 * instead of silently missing everything that happened while the backend was down.
 */
const eventCursorSchema = new Schema({
  name: { type: String, required: true, unique: true },
  lastProcessedBlock: { type: Number, default: 0 },
  updatedAt: { type: Date, default: () => new Date() },
})

export type EventCursorDocument = InferSchemaType<typeof eventCursorSchema>
export const EventCursor: Model<EventCursorDocument> = model<EventCursorDocument>('EventCursor', eventCursorSchema)
