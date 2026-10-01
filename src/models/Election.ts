import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/**
 * A cache of on-chain election state plus the fields that only exist off-chain.
 * The chain is authoritative: anything here may be stale and is refreshed by the event
 * listener and by every read path that matters.
 */
const electionSchema = new Schema(
  {
    chainElectionId: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },

    candidateRegistrationEnd: { type: Date, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },

    /** Mirrors VotingRegistry.ElectionStatus numerically. */
    status: { type: Number, default: 0, index: true },

    publicKeyN: { type: String, default: null },
    publicKeyNSquared: { type: String, default: null },
    /**
     * Where the key material went — NEVER the key itself. The private key is split into
     * trustee shares at setup and discarded; this records that fact for the audit trail.
     */
    privateKeyRef: { type: String, default: null },

    trusteeThreshold: { type: Number, default: 0 },
    trusteeCount: { type: Number, default: 0 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    txHashes: {
      created: { type: String, default: null },
      keyed: { type: String, default: null },
      trusteesSet: { type: String, default: null },
      opened: { type: String, default: null },
      votingOpened: { type: String, default: null },
      closed: { type: String, default: null },
      published: { type: String, default: null },
    },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

export type ElectionDocument = InferSchemaType<typeof electionSchema>
export const Election: Model<ElectionDocument> = model<ElectionDocument>('Election', electionSchema)
