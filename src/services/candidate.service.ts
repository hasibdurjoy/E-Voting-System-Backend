/**
 * Candidate applications.
 *
 * The profile lives off-chain; what is anchored on-chain is a hash of its canonical
 * serialisation, so a published manifesto cannot be quietly rewritten after approval.
 */
import { getChainTime, getReadOnlyContract } from '../blockchain/index.js'
import { profileHash as computeProfileHash } from '../crypto/commitment.js'
import { toChainCandidate } from '../mappers/chain.mapper.js'
import { Candidate, Election, User } from '../models/index.js'
import type { AuthenticatedUser } from '../middleware/auth.js'
import { CandidateStatus, ElectionStatus } from '../types/domain.js'
import { ApiError } from '../utils/ApiError.js'
import { readChainElection, type CandidateDto } from './election.service.js'
import { relay } from './relayer.service.js'

export interface CandidateApplicationInput {
  electionId: number
  party: string
  manifesto: string
  photoUrl?: string
}

interface CandidateRowView {
  chainCandidateId: number
  chainElectionId: number
  ballotIndex?: number | null
  party?: string | null
  manifesto?: string | null
  photoUrl?: string | null
  status: number
  profileHash: string
  submittedAt?: Date | null
  decidedAt?: Date | null
  rejectionReason?: string | null
}

function toDto(row: CandidateRowView, fullName: string): CandidateDto {
  return {
    id: row.chainCandidateId,
    electionId: row.chainElectionId,
    // Assigned by the contract on approval; null in every other state.
    ballotIndex: row.status === CandidateStatus.Approved ? (row.ballotIndex ?? null) : null,
    fullName,
    party: row.party ?? null,
    manifesto: row.manifesto ?? '',
    photoUrl: row.photoUrl ?? null,
    status: row.status,
    profileHash: row.profileHash,
    submittedAt: (row.submittedAt ?? new Date()).toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    rejectionReason: row.rejectionReason ?? null,
  }
}

export async function applyAsCandidate(
  user: AuthenticatedUser,
  input: CandidateApplicationInput,
): Promise<CandidateDto> {
  const chain = await readChainElection(input.electionId)

  if (chain.status !== ElectionStatus.CandidateRegistration) {
    throw ApiError.conflict('Candidate registration is not open for this election.')
  }
  if ((await getChainTime()) > chain.candidateRegistrationEnd) {
    throw ApiError.conflict('The candidate registration deadline has passed.')
  }
  if (user.revoked) {
    throw ApiError.forbidden('This account has been suspended. Contact the Election Commission.')
  }
  if (user.onHold) {
    throw ApiError.forbidden('Your registration is on hold while a dispute about your record is reviewed.')
  }
  // A candidate stands in their own Upazila. The contract enforces this too; checking
  // here turns a decoded revert into a sentence that explains itself.
  if (chain.upazilaId !== 0 && chain.upazilaId !== (user.upazilaId ?? 0)) {
    throw ApiError.forbidden('You can only stand as a candidate in the Upazila you are registered in.')
  }
  if (await Candidate.exists({ chainElectionId: input.electionId, userId: user._id })) {
    throw ApiError.conflict('You have already applied for this election.')
  }

  const profileHash = computeProfileHash({
    electionId: input.electionId,
    fullName: user.fullName,
    party: input.party || null,
    manifesto: input.manifesto,
    photoUrl: input.photoUrl ?? null,
  })

  const receipt = await relay<bigint>(
    'registerCandidate',
    'registerCandidate',
    [input.electionId, user.voterCommitment, profileHash],
    { simulateReturnValue: true },
  )
  const chainCandidateId = Number(receipt.returnValue)

  const election = await Election.findOne({ chainElectionId: input.electionId })
  if (!election) {
    // The cache row is written when the election is created; its absence means the backend
    // is pointed at a contract it did not set up, which is a configuration fault.
    throw ApiError.internal('This election is not known to the service. Please contact support.')
  }
  const row = await Candidate.create({
    electionId: election._id,
    chainElectionId: input.electionId,
    chainCandidateId,
    userId: user._id,
    party: input.party || null,
    manifesto: input.manifesto,
    photoUrl: input.photoUrl ?? null,
    profileHash,
    status: CandidateStatus.Pending,
    submittedAt: new Date(),
    txHash: receipt.txHash,
  })

  return toDto(row, user.fullName)
}

export async function listMyCandidacies(user: AuthenticatedUser): Promise<CandidateDto[]> {
  const rows = await Candidate.find({ userId: user._id }).sort({ submittedAt: -1 })
  const contract = getReadOnlyContract()

  // Status and ballot index are read back from the chain: the cached copy may lag behind an
  // approval, and showing a stale "pending" to an approved candidate is a real complaint.
  return Promise.all(
    rows.map(async (row) => {
      try {
        const chain = toChainCandidate(await contract.getCandidate(row.chainElectionId, row.chainCandidateId))
        return toDto({ ...row.toObject(), status: chain.status, ballotIndex: chain.ballotIndex }, user.fullName)
      } catch {
        return toDto(row, user.fullName)
      }
    }),
  )
}

export async function decideCandidate(
  electionId: number,
  chainCandidateId: number,
  status: typeof CandidateStatus.Approved | typeof CandidateStatus.Rejected,
  reason: string | undefined,
): Promise<CandidateDto> {
  if (status === CandidateStatus.Rejected && !reason?.trim()) {
    throw ApiError.badRequest('A reason is required when rejecting an application.')
  }

  const row = await Candidate.findOne({ chainElectionId: electionId, chainCandidateId })
  if (!row) throw ApiError.notFound('That candidate application does not exist.')

  const receipt = await relay('setCandidateStatus', 'setCandidateStatus', [electionId, chainCandidateId, status])

  // The ballot index is assigned by the contract on approval. It is READ BACK rather than
  // guessed: deriving it locally is how ballots end up counted for the wrong candidate.
  const contract = getReadOnlyContract()
  const chain = toChainCandidate(await contract.getCandidate(electionId, chainCandidateId))

  row.status = chain.status
  row.ballotIndex = chain.status === CandidateStatus.Approved ? chain.ballotIndex : null
  row.rejectionReason = status === CandidateStatus.Rejected ? (reason?.trim() ?? null) : null
  row.decidedAt = new Date()
  row.txHash = receipt.txHash
  await row.save()

  const applicant = await User.findById(row.userId)
  return toDto(row, applicant?.fullName ?? 'Unknown candidate')
}
