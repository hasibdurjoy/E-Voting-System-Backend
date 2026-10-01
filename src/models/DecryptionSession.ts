import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

const decryptionSessionSchema = new Schema(
  {
    electionId: { type: Schema.Types.ObjectId, ref: 'Election', required: true, index: true },
    chainElectionId: { type: Number, required: true, unique: true, index: true },
    threshold: { type: Number, required: true },
    sharesSubmitted: { type: Number, default: 0 },
    shares: [
      {
        _id: false,
        trusteeAddress: { type: String, required: true },
        shareIndex: { type: Number, required: true },
        txHash: { type: String, default: null },
        submittedAt: { type: Date, default: () => new Date() },
      },
    ],
    combinedAt: { type: Date, default: null },
    totals: { type: [Number], default: [] },
    publishTxHash: { type: String, default: null },
  },
  { timestamps: true },
)

export type DecryptionSessionDocument = InferSchemaType<typeof decryptionSessionSchema>
export const DecryptionSession: Model<DecryptionSessionDocument> = model<DecryptionSessionDocument>(
  'DecryptionSession',
  decryptionSessionSchema,
)
