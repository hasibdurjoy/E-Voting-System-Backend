import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/**
 * A voter's request to be moved to another Upazila.
 *
 * The evidence of the new address is held off-chain; only the approved outcome reaches the
 * chain, as a change of the voter's area tag.
 */
const areaTransferRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fromUpazilaId: { type: Number, required: true },
    toUpazilaId: { type: Number, required: true },
    /** What the voter offered as proof of the new address. Free text in this prototype. */
    evidence: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decisionReason: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    txHash: { type: String, default: null },
  },
  { timestamps: true },
)

// One open request per voter: a second one would be ambiguous to approve.
areaTransferRequestSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
)

export type AreaTransferRequestDocument = InferSchemaType<typeof areaTransferRequestSchema>
export const AreaTransferRequest: Model<AreaTransferRequestDocument> = model<AreaTransferRequestDocument>(
  'AreaTransferRequest',
  areaTransferRequestSchema,
)
