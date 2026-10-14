import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/**
 * Catalogue of Upazilas.
 *
 * The contract stores area ids as official codes rather than sequential indices, which
 * means they cannot be enumerated on-chain — a mapping has no list. This collection is the
 * readable catalogue, kept in step by the `UpazilaRegistered` event. The chain remains
 * authoritative for whether an id is valid.
 */
const upazilaSchema = new Schema(
  {
    upazilaId: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true },
    /** District or division, for display only. */
    district: { type: String, default: null },
    txHash: { type: String, default: null },
  },
  { timestamps: true },
)

export type UpazilaDocument = InferSchemaType<typeof upazilaSchema>
export const Upazila: Model<UpazilaDocument> = model<UpazilaDocument>('Upazila', upazilaSchema)
