import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/**
 * The half-finished registration between the NID step, the face step and account creation.
 * TTL-expired after 15 minutes; expiry surfaces as 410 Gone, which the frontend renders as
 * "your session expired, start again".
 */
const registrationSessionSchema = new Schema({
  token: { type: String, required: true, unique: true, index: true },

  nidEncrypted: { type: Buffer, required: true, select: false },
  nidLookupHash: { type: String, required: true, index: true, select: false },
  fullName: { type: String, required: true },
  dateOfBirth: { type: Date, required: true },

  nidVerified: { type: Boolean, default: false },
  faceVerified: { type: Boolean, default: false },
  faceMatchScore: { type: Number, default: null },
  livenessPassed: { type: Boolean, default: null },
  faceEmbedding: { type: Buffer, default: null, select: false },

  createdAt: { type: Date, default: () => new Date(), expires: 900 },
})

export type RegistrationSessionDocument = InferSchemaType<typeof registrationSessionSchema>
export const RegistrationSession: Model<RegistrationSessionDocument> = model<RegistrationSessionDocument>(
  'RegistrationSession',
  registrationSessionSchema,
)
