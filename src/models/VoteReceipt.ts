import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/**
 * Proof to the voter that their ballot was recorded.
 *
 * This row links a voter to a TRANSACTION, which is unavoidable if voters are to get
 * receipts and the server is to block double voting. It must never hold the ciphertext
 * itself or anything derived from the choice. `ciphertextHash` is safe only because the
 * ciphertext is randomised — the same vote encrypts differently every time.
 */
const voteReceiptSchema = new Schema(
  {
    electionId: { type: Schema.Types.ObjectId, ref: 'Election', required: true, index: true },
    chainElectionId: { type: Number, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    receiptCode: { type: String, required: true, index: true },
    txHash: { type: String, required: true },
    blockNumber: { type: Number, default: null },
    ciphertextHash: { type: String, required: true },

    castAt: { type: Date, default: () => new Date() },
    confirmed: { type: Boolean, default: false },
  },
  { timestamps: true },
)

// Database-level backstop behind the contract's hasVoted mapping.
voteReceiptSchema.index({ electionId: 1, userId: 1 }, { unique: true })

export type VoteReceiptDocument = InferSchemaType<typeof voteReceiptSchema>
export const VoteReceipt: Model<VoteReceiptDocument> = model<VoteReceiptDocument>('VoteReceipt', voteReceiptSchema)
