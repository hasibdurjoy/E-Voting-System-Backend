import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/**
 * A trustee of one election.
 *
 * THE KEY SHARE IS NOT HERE, AND MUST NEVER BE. The backend generates the shares during
 * election setup, hands each to its trustee once, and forgets it. Persisting a share would
 * mean the backend could reconstruct the key and decrypt alone — which is precisely the
 * property the threshold scheme exists to prevent.
 */
const trusteeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    electionId: { type: Schema.Types.ObjectId, ref: 'Election', required: true, index: true },
    chainElectionId: { type: Number, required: true, index: true },

    /** The trustee's own signing address — holds TRUSTEE_ROLE and sends the share itself. */
    address: { type: String, required: true, lowercase: true },
    /** 1-based Shamir index. Public. */
    shareIndex: { type: Number, required: true },
    /** vᵢ — public verification key, not the share. */
    verificationKey: { type: String, default: null },

    shareDelivered: { type: Boolean, default: false },
    shareSubmittedAt: { type: Date, default: null },
    shareTxHash: { type: String, default: null },
  },
  { timestamps: true },
)

trusteeSchema.index({ chainElectionId: 1, address: 1 }, { unique: true })

export type TrusteeDocument = InferSchemaType<typeof trusteeSchema>
export const Trustee: Model<TrusteeDocument> = model<TrusteeDocument>('Trustee', trusteeSchema)
