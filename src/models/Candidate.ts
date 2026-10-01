import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

const candidateSchema = new Schema(
  {
    electionId: { type: Schema.Types.ObjectId, ref: 'Election', required: true, index: true },
    chainElectionId: { type: Number, required: true, index: true },
    /** uint32 returned by registerCandidate(). 1-based within an election. */
    chainCandidateId: { type: Number, required: true },

    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    party: { type: String, default: null },
    manifesto: { type: String, default: '' },
    photoUrl: { type: String, default: null },
    /** keccak256 of the canonical profile, anchored on-chain. */
    profileHash: { type: String, required: true },

    /**
     * Base-B digit position used by the encryption. Assigned ONLY on approval, and always
     * read back from the chain — deriving it locally is how votes end up on the wrong name.
     */
    ballotIndex: { type: Number, default: null },
    /** Mirrors VotingRegistry.CandidateStatus numerically. */
    status: { type: Number, default: 1 },
    rejectionReason: { type: String, default: null },

    submittedAt: { type: Date, default: () => new Date() },
    decidedAt: { type: Date, default: null },
    txHash: { type: String, default: null },
  },
  { timestamps: true },
)

// One application per person per election — the contract enforces this too.
candidateSchema.index({ electionId: 1, userId: 1 }, { unique: true })
candidateSchema.index({ chainElectionId: 1, chainCandidateId: 1 }, { unique: true })

export type CandidateDocument = InferSchemaType<typeof candidateSchema>
export const Candidate: Model<CandidateDocument> = model<CandidateDocument>('Candidate', candidateSchema)
