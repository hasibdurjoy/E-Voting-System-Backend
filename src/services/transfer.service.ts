/**
 * Moving a voter between Upazilas.
 *
 * The voter asks, a validator decides, and only the approved outcome reaches the chain —
 * as a replacement of the voter's area tag, so nobody is ever eligible in two areas at
 * once. The previous area stays recoverable from the `VoterAreaChanged` event.
 *
 * THE CUTOFF. Transfers are refused once an election the voter could take part in has
 * passed its candidate-registration deadline and has not yet closed. That is the rule the
 * contract cannot enforce affordably — it would have to iterate every election on every
 * transfer — so it lives here, where the schedule is already known.
 */
import { getReadOnlyContract } from '../blockchain/index.js'
import { getChainTime } from '../blockchain/index.js'
import { toChainElection } from '../mappers/chain.mapper.js'
import type { AuthenticatedUser } from '../middleware/auth.js'
import { AreaTransferRequest, User } from '../models/index.js'
import { ElectionStatus } from '../types/domain.js'
import { ApiError } from '../utils/ApiError.js'
import { assertUpazilaExists, upazilaName } from './area.service.js'
import { relay } from './relayer.service.js'

export interface TransferRequestDto {
  id: string
  userId: string
  fullName: string
  fromUpazilaId: number
  fromUpazilaName: string | null
  toUpazilaId: number
  toUpazilaName: string | null
  evidence: string
  status: 'pending' | 'approved' | 'rejected'
  decisionReason: string | null
  requestedAt: string
  decidedAt: string | null
  txHash: string | null
}

interface TransferRow {
  _id: unknown
  userId: unknown
  fromUpazilaId: number
  toUpazilaId: number
  evidence?: string | null
  status: string
  decisionReason?: string | null
  createdAt?: Date
  decidedAt?: Date | null
  txHash?: string | null
}

async function toDto(row: TransferRow, fullName: string): Promise<TransferRequestDto> {
  return {
    id: String(row._id),
    userId: String(row.userId),
    fullName,
    fromUpazilaId: row.fromUpazilaId,
    fromUpazilaName: await upazilaName(row.fromUpazilaId),
    toUpazilaId: row.toUpazilaId,
    toUpazilaName: await upazilaName(row.toUpazilaId),
    evidence: row.evidence ?? '',
    status: row.status as TransferRequestDto['status'],
    decisionReason: row.decisionReason ?? null,
    requestedAt: (row.createdAt ?? new Date()).toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    txHash: row.txHash ?? null,
  }
}

/**
 * The cutoff. An election "in progress" for either area blocks the move: once candidate
 * registration has closed, the roll for that election is what voters and candidates were
 * entitled to rely on.
 */
async function assertNoElectionInProgress(areas: number[]): Promise<void> {
  const contract = getReadOnlyContract()
  const count = Number((await contract.electionCount()) as bigint)
  if (count === 0) return

  const now = await getChainTime()
  for (let id = 1; id <= count; id++) {
    const election = toChainElection(await contract.getElection(id))
    if (election.status === ElectionStatus.ResultsPublished || election.status === ElectionStatus.Closed) continue
    // A national election affects every area; an area election only its own.
    if (election.upazilaId !== 0 && !areas.includes(election.upazilaId)) continue
    // Past its end time no ballot can be cast in it, whether or not an administrator has
    // got around to closing it — so a transfer cannot affect it. Without this, one
    // abandoned election would block every transfer in its area indefinitely.
    if (now >= election.endTime) continue

    const cutoffPassed = now >= election.candidateRegistrationEnd
    const inProgress = election.status === ElectionStatus.Voting || cutoffPassed
    if (inProgress) {
      throw ApiError.conflict(
        `Transfers are closed while "${election.name}" is in progress. Please apply again once it has finished.`,
      )
    }
  }
}

export async function requestTransfer(
  user: AuthenticatedUser,
  input: { toUpazilaId: number; evidence: string },
): Promise<TransferRequestDto> {
  const from = user.upazilaId ?? 0
  if (input.toUpazilaId === from) {
    throw ApiError.conflict('You are already registered in that Upazila.')
  }
  await assertUpazilaExists(input.toUpazilaId)
  if (await AreaTransferRequest.exists({ userId: user._id, status: 'pending' })) {
    throw ApiError.conflict('You already have a transfer request awaiting review.')
  }
  await assertNoElectionInProgress([from, input.toUpazilaId])

  const row = await AreaTransferRequest.create({
    userId: user._id,
    fromUpazilaId: from,
    toUpazilaId: input.toUpazilaId,
    evidence: input.evidence,
    status: 'pending',
  })

  return toDto(row as unknown as TransferRow, user.fullName)
}

export async function listMyTransfers(user: AuthenticatedUser): Promise<TransferRequestDto[]> {
  const rows = await AreaTransferRequest.find({ userId: user._id }).sort({ createdAt: -1 })
  return Promise.all(rows.map((row) => toDto(row as unknown as TransferRow, user.fullName)))
}

export async function listPendingTransfers(): Promise<TransferRequestDto[]> {
  const rows = await AreaTransferRequest.find({ status: 'pending' }).sort({ createdAt: 1 })
  const users = await User.find({ _id: { $in: rows.map((row) => row.userId) } })
  const names = new Map(users.map((entry) => [String(entry._id), entry.fullName]))
  return Promise.all(
    rows.map((row) => toDto(row as unknown as TransferRow, names.get(String(row.userId)) ?? 'Unknown voter')),
  )
}

export async function decideTransfer(
  requestId: string,
  decision: { approve: boolean; reason?: string },
  decidedBy: string,
): Promise<TransferRequestDto> {
  const row = await AreaTransferRequest.findById(requestId)
  if (!row) throw ApiError.notFound('That transfer request does not exist.')
  if (row.status !== 'pending') throw ApiError.conflict('This transfer request has already been decided.')

  const voter = await User.findById(row.userId)
  if (!voter) throw ApiError.notFound('That voter does not exist.')

  if (!decision.approve) {
    if (!decision.reason?.trim()) throw ApiError.badRequest('A reason is required when rejecting a transfer.')
    row.status = 'rejected'
    row.decisionReason = decision.reason.trim()
    row.decidedBy = decidedBy as never
    row.decidedAt = new Date()
    await row.save()
    return toDto(row as unknown as TransferRow, voter.fullName)
  }

  // Re-checked at decision time: an election may have opened since the request was filed.
  await assertNoElectionInProgress([row.fromUpazilaId, row.toUpazilaId])

  const receipt = await relay('transferVoterArea', 'transferVoterArea', [voter.voterCommitment, row.toUpazilaId])

  voter.upazilaId = row.toUpazilaId
  await voter.save()

  row.status = 'approved'
  row.decisionReason = decision.reason?.trim() ?? null
  row.decidedBy = decidedBy as never
  row.decidedAt = new Date()
  row.txHash = receipt.txHash
  await row.save()

  return toDto(row as unknown as TransferRow, voter.fullName)
}
