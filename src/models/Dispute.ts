import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/**
 * A dispute about a voter's record — raised by the voter or by a validator.
 *
 * While it is open the voter's participation is suspended on-chain. The dispute text stays
 * off-chain: it describes a named person. Only a hash of the record is anchored, which is
 * enough to show afterwards that the decision was about this dispute and not another.
 */
const disputeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    raisedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    raisedByRole: { type: String, enum: ['voter', 'admin'], default: 'voter' },
    category: {
      type: String,
      enum: ['wrong-area', 'wrong-personal-details', 'wrongly-revoked', 'duplicate-registration', 'other'],
      required: true,
    },
    detail: { type: String, required: true },
    status: { type: String, enum: ['open', 'upheld', 'rejected'], default: 'open', index: true },
    /** keccak256 of the canonical dispute record, anchored with the hold. */
    reasonHash: { type: String, default: null },
    resolution: { type: String, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    holdTxHash: { type: String, default: null },
    releaseTxHash: { type: String, default: null },
  },
  { timestamps: true },
)

disputeSchema.index({ userId: 1, status: 1 })

export type DisputeDocument = InferSchemaType<typeof disputeSchema>
export const Dispute: Model<DisputeDocument> = model<DisputeDocument>('Dispute', disputeSchema)
