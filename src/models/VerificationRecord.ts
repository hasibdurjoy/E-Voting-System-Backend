import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/** Audit of an identity check. Holds NO raw NID and NO image — only the outcome. */
const verificationRecordSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  registrationToken: { type: String, default: null },
  type: { type: String, enum: ['nid', 'face'], required: true },
  provider: { type: String, required: true },
  outcome: { type: String, enum: ['passed', 'failed'], required: true },
  failureReason: { type: String, default: null },
  matchScore: { type: Number, default: null },
  livenessPassed: { type: Boolean, default: null },
  createdAt: { type: Date, default: () => new Date() },
})

export type VerificationRecordDocument = InferSchemaType<typeof verificationRecordSchema>
export const VerificationRecord: Model<VerificationRecordDocument> = model<VerificationRecordDocument>(
  'VerificationRecord',
  verificationRecordSchema,
)
