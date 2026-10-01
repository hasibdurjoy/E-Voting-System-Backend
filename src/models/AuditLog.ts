import { model, Schema, type InferSchemaType, type Model } from 'mongoose'

/** Who did what. `ipHash`, never a raw IP. */
const auditLogSchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  actorRole: { type: String, default: null },
  action: { type: String, required: true, index: true },
  targetType: { type: String, default: null },
  targetId: { type: String, default: null },
  outcome: { type: String, enum: ['success', 'failure'], required: true },
  detail: { type: String, default: null },
  ipHash: { type: String, default: null },
  userAgent: { type: String, default: null },
  txHash: { type: String, default: null },
  createdAt: { type: Date, default: () => new Date(), index: true },
})

export type AuditLogDocument = InferSchemaType<typeof auditLogSchema>
export const AuditLog: Model<AuditLogDocument> = model<AuditLogDocument>('AuditLog', auditLogSchema)
