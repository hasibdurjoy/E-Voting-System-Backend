/**
 * Disputes over a voter's record.
 *
 * A voter or a validator raises one; the voter's participation is suspended on-chain while
 * it is open; a validator resolves it, which either corrects the record or releases the
 * hold unchanged. The record itself is never deleted — the chain keeps the history, and
 * the hold is a flag rather than an erasure.
 *
 * WHAT GOES ON-CHAIN. Only the hold and a keccak256 of the dispute record. The dispute text
 * describes a named person and their address, so publishing it would undo exactly the
 * privacy the commitment scheme provides. The hash is enough to show afterwards that a
 * decision belonged to this dispute and not to another one.
 */
import { keccak256, toUtf8Bytes } from 'ethers'
import type { AuthenticatedUser } from '../middleware/auth.js'
import { Dispute, User } from '../models/index.js'
import { ApiError } from '../utils/ApiError.js'
import { upazilaName } from './area.service.js'
import { relay } from './relayer.service.js'

export type DisputeCategory =
  | 'wrong-area'
  | 'wrong-personal-details'
  | 'wrongly-revoked'
  | 'duplicate-registration'
  | 'other'

export interface DisputeDto {
  id: string
  userId: string
  fullName: string
  maskedNid: string
  upazilaId: number
  upazilaName: string | null
  category: DisputeCategory
  detail: string
  status: 'open' | 'upheld' | 'rejected'
  resolution: string | null
  raisedAt: string
  resolvedAt: string | null
  holdTxHash: string | null
  releaseTxHash: string | null
}

interface DisputeRow {
  _id: unknown
  userId: unknown
  category: string
  detail: string
  status: string
  resolution?: string | null
  createdAt?: Date
  resolvedAt?: Date | null
  holdTxHash?: string | null
  releaseTxHash?: string | null
}

async function toDto(
  row: DisputeRow,
  voter: { fullName: string; nidMasked: string; upazilaId?: number },
): Promise<DisputeDto> {
  return {
    id: String(row._id),
    userId: String(row.userId),
    fullName: voter.fullName,
    maskedNid: voter.nidMasked,
    upazilaId: voter.upazilaId ?? 0,
    upazilaName: await upazilaName(voter.upazilaId ?? 0),
    category: row.category as DisputeCategory,
    detail: row.detail,
    status: row.status as DisputeDto['status'],
    resolution: row.resolution ?? null,
    raisedAt: (row.createdAt ?? new Date()).toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    holdTxHash: row.holdTxHash ?? null,
    releaseTxHash: row.releaseTxHash ?? null,
  }
}

/** The canonical record that the on-chain hash commits to. */
function disputeReasonHash(input: { userId: string; category: string; detail: string; raisedAt: string }): string {
  return keccak256(toUtf8Bytes([input.userId, input.category, input.detail.trim(), input.raisedAt].join('\u001f')))
}

export async function raiseDispute(
  user: AuthenticatedUser,
  input: { category: DisputeCategory; detail: string; subjectUserId?: string },
  raisedByRole: 'voter' | 'admin',
): Promise<DisputeDto> {
  // A voter may only dispute their own record; a validator may dispute anyone's.
  const subjectId = raisedByRole === 'admin' && input.subjectUserId ? input.subjectUserId : String(user._id)
  const subject = await User.findById(subjectId)
  if (!subject) throw ApiError.notFound('That voter does not exist.')

  if (await Dispute.exists({ userId: subject._id, status: 'open' })) {
    throw ApiError.conflict('There is already an open dispute about this record.')
  }

  const raisedAt = new Date()
  const reasonHash = disputeReasonHash({
    userId: String(subject._id),
    category: input.category,
    detail: input.detail,
    raisedAt: raisedAt.toISOString(),
  })

  // The hold goes on-chain first: eligibility must be suspended from the moment the
  // dispute exists, not from whenever the database write happens to land.
  const receipt = await relay('setVoterHold', 'setVoterHold', [subject.voterCommitment, true, reasonHash])

  const row = await Dispute.create({
    userId: subject._id,
    raisedBy: user._id,
    raisedByRole,
    category: input.category,
    detail: input.detail.trim(),
    status: 'open',
    reasonHash,
    holdTxHash: receipt.txHash,
    createdAt: raisedAt,
  })

  subject.onHold = true
  await subject.save()

  return toDto(row as unknown as DisputeRow, subject)
}

export async function listMyDisputes(user: AuthenticatedUser): Promise<DisputeDto[]> {
  const rows = await Dispute.find({ userId: user._id }).sort({ createdAt: -1 })
  return Promise.all(rows.map((row) => toDto(row as unknown as DisputeRow, user)))
}

export async function listOpenDisputes(): Promise<DisputeDto[]> {
  const rows = await Dispute.find({ status: 'open' }).sort({ createdAt: 1 })
  const users = await User.find({ _id: { $in: rows.map((row) => row.userId) } })
  const byId = new Map(users.map((entry) => [String(entry._id), entry]))
  return Promise.all(
    rows.map((row) =>
      toDto(row as unknown as DisputeRow, byId.get(String(row.userId)) ?? { fullName: 'Unknown voter', nidMasked: '••••' }),
    ),
  )
}

export interface DisputeResolution {
  /** `upheld` means the complaint was correct; `rejected` means the record stands. */
  outcome: 'upheld' | 'rejected'
  resolution: string
  /** When upholding a wrong-area dispute, the area the record should have had. */
  correctedUpazilaId?: number
}

export async function resolveDispute(
  disputeId: string,
  decision: DisputeResolution,
  resolvedBy: string,
): Promise<DisputeDto> {
  const row = await Dispute.findById(disputeId)
  if (!row) throw ApiError.notFound('That dispute does not exist.')
  if (row.status !== 'open') throw ApiError.conflict('This dispute has already been resolved.')
  if (!decision.resolution.trim()) throw ApiError.badRequest('A resolution note is required.')

  const subject = await User.findById(row.userId)
  if (!subject) throw ApiError.notFound('That voter does not exist.')

  // Correcting the record is part of upholding the dispute, and happens before the hold
  // is released so the voter is never briefly eligible with the wrong area.
  if (decision.outcome === 'upheld' && decision.correctedUpazilaId && decision.correctedUpazilaId !== subject.upazilaId) {
    await relay('transferVoterArea', 'transferVoterArea', [subject.voterCommitment, decision.correctedUpazilaId])
    subject.upazilaId = decision.correctedUpazilaId
  }

  const receipt = await relay('setVoterHold', 'setVoterHold', [
    subject.voterCommitment,
    false,
    row.reasonHash ?? '0x' + '0'.repeat(64),
  ])

  subject.onHold = false
  await subject.save()

  row.status = decision.outcome
  row.resolution = decision.resolution.trim()
  row.resolvedBy = resolvedBy as never
  row.resolvedAt = new Date()
  row.releaseTxHash = receipt.txHash
  await row.save()

  return toDto(row as unknown as DisputeRow, subject)
}
