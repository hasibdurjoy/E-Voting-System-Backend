/** Election Commission operations: oversight figures, the voter roll, and revocation. */
import { getReadOnlyContract } from '../blockchain/index.js'
import { Candidate, Election, User, VoteReceipt } from '../models/index.js'
import { CandidateStatus, ElectionStatus } from '../types/domain.js'
import { ApiError } from '../utils/ApiError.js'
import { relay } from './relayer.service.js'

export interface AdminStatsDto {
  totalVoters: number
  revokedVoters: number
  totalElections: number
  activeElections: number
  pendingCandidates: number
  totalVotesCast: number
}

export interface VoterSummaryDto {
  id: string
  fullName: string
  maskedNid: string
  voterCommitment: string
  registeredAt: string
  revoked: boolean
  electionsVoted: number
}

export async function getAdminStats(): Promise<AdminStatsDto> {
  const contract = getReadOnlyContract()
  const electionCount = Number((await contract.electionCount()) as bigint)

  const chainElections = await Promise.all(
    Array.from({ length: electionCount }, (_, index) =>
      contract.getElection(index + 1).then((raw) => raw as { status: bigint; voteCount: bigint }),
    ),
  )

  const [totalVoters, revokedVoters, pendingCandidates] = await Promise.all([
    User.countDocuments({ roles: 'voter' }),
    User.countDocuments({ revoked: true }),
    Candidate.countDocuments({ status: CandidateStatus.Pending }),
  ])

  return {
    totalVoters,
    revokedVoters,
    totalElections: electionCount,
    activeElections: chainElections.filter((election) => {
      const status = Number(election.status)
      return status === ElectionStatus.CandidateRegistration || status === ElectionStatus.Voting
    }).length,
    pendingCandidates,
    totalVotesCast: chainElections.reduce((sum, election) => sum + Number(election.voteCount), 0),
  }
}

export async function listVoters(): Promise<VoterSummaryDto[]> {
  const users = await User.find({ roles: 'voter' }).sort({ registeredAt: -1 })
  const receipts = await VoteReceipt.find({ userId: { $in: users.map((user) => user._id) } })

  const votesByUser = new Map<string, number>()
  for (const receipt of receipts) {
    const key = String(receipt.userId)
    votesByUser.set(key, (votesByUser.get(key) ?? 0) + 1)
  }

  // maskedNid only — the raw National ID never leaves the backend, not even for an admin.
  return users.map((user) => ({
    id: String(user._id),
    fullName: user.fullName,
    maskedNid: user.nidMasked,
    voterCommitment: user.voterCommitment,
    registeredAt: new Date(user.registeredAt ?? Date.now()).toISOString(),
    revoked: Boolean(user.revoked),
    electionsVoted: votesByUser.get(String(user._id)) ?? 0,
  }))
}

export async function revokeVoter(userId: string): Promise<VoterSummaryDto> {
  const user = await User.findById(userId)
  if (!user) throw ApiError.notFound('That voter does not exist.')
  if (user.revoked) throw ApiError.conflict('This voter registration has already been revoked.')

  // On-chain first: a voter marked revoked locally but still able to vote on-chain would be
  // worse than no revocation at all.
  await relay('revokeVoter', 'revokeVoter', [user.voterCommitment])

  user.revoked = true
  await user.save()

  const electionsVoted = await VoteReceipt.countDocuments({ userId: user._id })
  return {
    id: String(user._id),
    fullName: user.fullName,
    maskedNid: user.nidMasked,
    voterCommitment: user.voterCommitment,
    registeredAt: new Date(user.registeredAt ?? Date.now()).toISOString(),
    revoked: true,
    electionsVoted,
  }
}

/** Used by the dashboard to list applications awaiting a decision. */
export async function listPendingCandidates(): Promise<{ electionId: number; candidateId: number }[]> {
  const rows = await Candidate.find({ status: CandidateStatus.Pending })
  return rows.map((row) => ({ electionId: row.chainElectionId, candidateId: row.chainCandidateId }))
}

export async function ensureElectionExists(electionId: number): Promise<void> {
  if (!(await Election.exists({ chainElectionId: electionId }))) {
    throw ApiError.notFound('That election does not exist.')
  }
}
