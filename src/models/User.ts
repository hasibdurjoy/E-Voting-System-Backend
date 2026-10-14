import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/**
 * A registered voter.
 *
 * Identity lives here and only here — the chain sees `voterCommitment` and nothing else.
 * There is deliberately no plaintext `nid` field: the NID is stored encrypted, and the two
 * derivations (see `crypto/commitment.ts`) cover duplicate detection and on-chain identity
 * separately.
 */
const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },

    /** AES-256-GCM under PII_ENCRYPTION_KEY. */
    nidEncrypted: { type: Buffer, required: true, select: false },
    /** HMAC under the server pepper — duplicate detection. Never leaves the backend. */
    nidLookupHash: { type: String, required: true, unique: true, index: true, select: false },
    /** Per-voter randomness behind the commitment, encrypted at rest. */
    commitmentSalt: { type: Buffer, required: true, select: false },
    /** keccak256(nid ‖ salt) — the on-chain identifier. */
    voterCommitment: { type: String, required: true, unique: true, index: true },
    /** "•••• •••• 4821" — the only form of the NID that may appear in a response. */
    nidMasked: { type: String, required: true },

    dateOfBirth: { type: Date, required: true },
    /**
     * The voter's Upazila, resolved from their National ID record when a validator
     * approved them. It is an eligibility tag, and the same value is held on-chain.
     */
    upazilaId: { type: Number, required: true, index: true },
    /** True while a dispute about this voter's record is unresolved. */
    onHold: { type: Boolean, default: false },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, default: null },
    passwordHash: { type: String, required: true, select: false },

    roles: { type: [String], enum: ['voter', 'admin', 'trustee'], default: ['voter'] },
    /**
     * Only trustees need one: it is the address that holds TRUSTEE_ROLE and submits their
     * decryption share. Voters never need a wallet — the relayer pays for their ballot.
     */
    walletAddress: { type: String, default: null, lowercase: true, index: true },

    /** Face embedding, encrypted. The selfie image itself is never written anywhere. */
    faceEmbedding: { type: Buffer, default: null, select: false },

    revoked: { type: Boolean, default: false },
    registeredAt: { type: Date, default: () => new Date() },
    registrationTxHash: { type: String, default: null },
  },
  { timestamps: true },
)

export type UserDocument = InferSchemaType<typeof userSchema>
export const User: Model<UserDocument> = model<UserDocument>('User', userSchema)
