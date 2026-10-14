/**
 * Elections: reading them from the chain, and creating them.
 *
 * Reads treat the chain as authoritative and Mongo as a cache for the fields that have no
 * on-chain representation (descriptions, candidate names, manifestos). When the two
 * disagree about anything the contract stores — status, counts, ballot indices — the chain
 * wins, every time.
 *
 * Creation is the one place that handles key material: it generates the Paillier keypair,
 * splits the private key across the trustees, writes the public half on-chain and then
 * DISCARDS the private half. The shares are returned to the caller exactly once, for
 * out-of-band delivery, and are never written to the database or the logs.
 */
import { getChainTime, getReadOnlyContract } from '../blockchain/index.js'
import { assertUpazilaExists, upazilaName, upazilaNames } from './area.service.js'
import { BALLOT_BASE, env } from '../config/env.js'
import { generateKeyPair, serialisePublicKey } from '../crypto/paillier.js'
import { createThresholdSetup, serialiseTrusteeShare } from '../crypto/threshold.js'
import {
  dateToSeconds,
  toChainCandidate,
  toChainElection,
  type ChainCandidate,
  type ChainElection,
} from '../mappers/chain.mapper.js'
import { Candidate, DecryptionSession, Election, Trustee, User } from '../models/index.js'
import { CandidateStatus, ElectionStatus } from '../types/domain.js'
import { ApiError } from '../utils/ApiError.js'
import { logger } from '../utils/logger.js'
import { relay } from './relayer.service.js'

export interface PaillierPublicKeyDto {
  n: string
  nSquared: string
  ballotBase: string
}

export interface ElectionDto {
  id: number
  name: string
  description: string
  /** Upazila this election is held in; 0 means national, open to every area. */
  upazilaId: number
  upazilaName: string | null
  candidateRegistrationEnd: string
  startTime: string
  endTime: string
  status: number
  candidateCount: number
  approvedCandidateCount: number
  voteCount: number
  trusteeCount: number
  trusteeThreshold: number
  decryptionShareCount: number
}

export interface CandidateDto {
  id: number
  electionId: number
  ballotIndex: number | null
  fullName: string
  party: string | null
  manifesto: string
  photoUrl: string | null
  status: number
  profileHash: string
  submittedAt: string
  decidedAt: string | null
  rejectionReason: string | null
}

export interface ElectionDetailDto extends ElectionDto {
  candidates: CandidateDto[]
  publicKey: PaillierPublicKeyDto | null
}

// ── reads ────────────────────────────────────────────────────────────────────

export async function readChainElection(electionId: number): Promise<ChainElection> {
  const contract = getReadOnlyContract()
  try {
    return toChainElection(await contract.getElection(electionId))
  } catch {
    throw ApiError.notFound('That election does not exist.')
  }
}

function toElectionDto(chain: ChainElection, description: string, areaName: string | null = null): ElectionDto {
  return {
    id: chain.id,
    name: chain.name,
    description,
    upazilaId: chain.upazilaId,
    upazilaName: areaName,
    candidateRegistrationEnd: chain.candidateRegistrationEnd.toISOString(),
    startTime: chain.startTime.toISOString(),
    endTime: chain.endTime.toISOString(),
    status: chain.status,
    candidateCount: chain.candidateCount,
    approvedCandidateCount: chain.approvedCandidateCount,
    voteCount: chain.voteCount,
    trusteeCount: chain.trusteeCount,
    trusteeThreshold: chain.trusteeThreshold,
    decryptionShareCount: chain.decryptionShareCount,
  }
}

export async function listElections(): Promise<ElectionDto[]> {
  const contract = getReadOnlyContract()
  const count = Number((await contract.electionCount()) as bigint)
  if (count === 0) return []

  const chainElections = await Promise.all(
    Array.from({ length: count }, (_, index) => contract.getElection(index + 1).then(toChainElection)),
  )
  const cached = await Election.find({ chainElectionId: { $in: chainElections.map((e) => e.id) } })
  const descriptions = new Map(cached.map((row) => [row.chainElectionId, row.description ?? '']))
  const areaNames = await upazilaNames(chainElections.map((election) => election.upazilaId))

  // Refresh the cached status in the background; a stale cache must never block a read.
  void syncStatusCache(chainElections)

  return chainElections.map((chain) =>
    toElectionDto(chain, chain.description || (descriptions.get(chain.id) ?? ''), areaNames.get(chain.upazilaId) ?? null),
  )
}

async function syncStatusCache(elections: ChainElection[]): Promise<void> {
  try {
    await Promise.all(
      elections.map((election) =>
        Election.updateOne({ chainElectionId: election.id }, { $set: { status: election.status } }),
      ),
    )
  } catch (error) {
    logger.debug(`Election status cache refresh failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Candidate records, merged chain + off-chain. Chain supplies status and ballot index. */
export async function listCandidates(electionId: number, chainStatus: number): Promise<CandidateDto[]> {
  const contract = getReadOnlyContract()
  const chainElection = await readChainElection(electionId)

  const chainCandidates: ChainCandidate[] = await Promise.all(
    Array.from({ length: chainElection.candidateCount }, (_, index) =>
      contract.getCandidate(electionId, index + 1).then(toChainCandidate),
    ),
  )

  const cached = await Candidate.find({ chainElectionId: electionId }).populate<{
    userId: { fullName: string } | null
  }>('userId', 'fullName')
  const byChainId = new Map(cached.map((row) => [row.chainCandidateId, row]))

  const candidates = chainCandidates.map((chain) => {
    const row = byChainId.get(chain.id)
    const populatedUser = row?.userId as unknown as { fullName?: string } | null
    return {
      id: chain.id,
      electionId,
      // Assigned on approval; null while pending, exactly as the contract reports it.
      ballotIndex: chain.status === CandidateStatus.Approved ? chain.ballotIndex : null,
      fullName: populatedUser?.fullName ?? 'Unknown candidate',
      party: row?.party ?? null,
      manifesto: row?.manifesto ?? '',
      photoUrl: row?.photoUrl ?? null,
      status: chain.status,
      profileHash: chain.profileHash,
      submittedAt: (row?.submittedAt ?? new Date()).toISOString(),
      decidedAt: row?.decidedAt ? row.decidedAt.toISOString() : null,
      rejectionReason: row?.rejectionReason ?? null,
    }
  })

  // Once voting is open the ballot is fixed: only approved candidates may be shown, or the
  // UI would offer names that cannot be voted for.
  if (chainStatus >= ElectionStatus.Voting) {
    return candidates.filter((candidate) => candidate.status === CandidateStatus.Approved)
  }
  return candidates
}

export async function getElectionPublicKey(electionId: number): Promise<PaillierPublicKeyDto | null> {
  const contract = getReadOnlyContract()
  const [n, nSquared] = (await contract.getElectionKey(electionId)) as [string, string]
  if (!n || n === '0x') return null
  return { n, nSquared, ballotBase: BALLOT_BASE.toString() }
}

export async function getElectionDetail(electionId: number): Promise<ElectionDetailDto> {
  const chain = await readChainElection(electionId)
  const cached = await Election.findOne({ chainElectionId: electionId })
  const [candidates, publicKey] = await Promise.all([
    listCandidates(electionId, chain.status),
    getElectionPublicKey(electionId),
  ])

  return {
    ...toElectionDto(chain, chain.description || (cached?.description ?? ''), await upazilaName(chain.upazilaId)),
    candidates,
    publicKey,
  }
}

// ── creation ─────────────────────────────────────────────────────────────────

export interface CreateElectionInput {
  name: string
  description: string
  /** Upazila this election is held in. Omit or pass 0 for a national election. */
  upazilaId?: number
  candidateRegistrationEnd: string
  startTime: string
  endTime: string
  trusteeThreshold: number
  trusteeCount: number
}

export interface CreateElectionResult extends ElectionDto {
  /**
   * The trustee key shares, returned EXACTLY ONCE. They are not stored anywhere — deliver
   * each one to its trustee over a secure channel. If they are lost before delivery, the
   * election cannot be decrypted and must be recreated.
   */
  trusteeShares: { address: string; shareIndex: number; share: string }[]
  trusteeShareDelivery: 'one-time-response'
}

export async function createElection(input: CreateElectionInput, createdBy: string): Promise<CreateElectionResult> {
  const candidateRegistrationEnd = new Date(input.candidateRegistrationEnd)
  const startTime = new Date(input.startTime)
  const endTime = new Date(input.endTime)

  // Checked here so the admin gets a readable 422 instead of a decoded revert.
  if (candidateRegistrationEnd > startTime) {
    throw ApiError.unprocessable('Candidate registration must end before voting starts.')
  }
  if (startTime >= endTime) {
    throw ApiError.unprocessable('The election must start before it ends.')
  }
  if (endTime <= (await getChainTime())) {
    throw ApiError.unprocessable('The election must end in the future.')
  }
  if (input.trusteeThreshold < 2) {
    throw ApiError.unprocessable('At least two trustees must be required to decrypt a result.')
  }
  if (input.trusteeThreshold > input.trusteeCount) {
    throw ApiError.unprocessable('The threshold cannot exceed the number of trustees.')
  }

  const upazilaId = input.upazilaId ?? 0
  // Refused here with a readable message rather than as a decoded revert later.
  await assertUpazilaExists(upazilaId)

  const trusteeAddresses = env.TRUSTEE_ADDRESSES.slice(0, input.trusteeCount)
  if (trusteeAddresses.length < input.trusteeCount) {
    throw ApiError.unprocessable(
      `Only ${env.TRUSTEE_ADDRESSES.length} trustee addresses are configured, but ${input.trusteeCount} were requested.`,
    )
  }

  // 1 ── the election itself
  const created = await relay<bigint>(
    'createElection',
    'createElection',
    [
      input.name,
      input.description,
      upazilaId,
      dateToSeconds(candidateRegistrationEnd),
      dateToSeconds(startTime),
      dateToSeconds(endTime),
    ],
    { simulateReturnValue: true },
  )
  const electionId = Number(created.returnValue)

  // 2 ── key material. The private key exists only inside this function.
  const { publicKey, privateKey } = generateKeyPair(env.PAILLIER_KEY_BITS)
  const serialisedKey = serialisePublicKey(publicKey)
  const setup = createThresholdSetup(publicKey, privateKey, input.trusteeCount, input.trusteeThreshold)

  const keyed = await relay('setElectionKey', 'setElectionKey', [electionId, serialisedKey.n, serialisedKey.nSquared])

  // 3 ── the trustee committee (this also grants TRUSTEE_ROLE to each address)
  const trusteesSet = await relay('setElectionTrustees', 'setElectionTrustees', [
    electionId,
    trusteeAddresses,
    input.trusteeThreshold,
  ])

  const election = await Election.create({
    chainElectionId: electionId,
    name: input.name,
    description: input.description,
    upazilaId,
    candidateRegistrationEnd,
    startTime,
    endTime,
    status: ElectionStatus.Draft,
    publicKeyN: serialisedKey.n,
    publicKeyNSquared: serialisedKey.nSquared,
    // Not the key — a note that it was split and discarded, for the audit trail.
    privateKeyRef: `split:${input.trusteeThreshold}-of-${input.trusteeCount}:discarded-at-setup`,
    trusteeThreshold: input.trusteeThreshold,
    trusteeCount: input.trusteeCount,
    createdBy,
    txHashes: { created: created.txHash, keyed: keyed.txHash, trusteesSet: trusteesSet.txHash },
  })

  // Trustee rows record WHO holds a share, never the share itself.
  const trusteeUsers = await User.find({ walletAddress: { $in: trusteeAddresses.map((a) => a.toLowerCase()) } })
  const userByAddress = new Map(trusteeUsers.map((user) => [user.walletAddress?.toLowerCase(), user._id]))

  await Trustee.insertMany(
    setup.shares.map((share, index) => ({
      userId: userByAddress.get(trusteeAddresses[index].toLowerCase()) ?? null,
      electionId: election._id,
      chainElectionId: electionId,
      address: trusteeAddresses[index].toLowerCase(),
      shareIndex: share.index,
      verificationKey: share.verificationKey.toString(16),
      shareDelivered: true,
    })),
  )

  await DecryptionSession.create({
    electionId: election._id,
    chainElectionId: electionId,
    threshold: input.trusteeThreshold,
  })

  const chain = await readChainElection(electionId)

  // The shares leave this function once, in the response. Nothing logs them, nothing
  // stores them, and `privateKey` goes out of scope here along with the whole key.
  return {
    ...toElectionDto(chain, input.description, await upazilaName(upazilaId)),
    trusteeShares: setup.shares.map((share, index) => ({
      address: trusteeAddresses[index],
      shareIndex: share.index,
      share: serialiseTrusteeShare(share, setup.delta),
    })),
    trusteeShareDelivery: 'one-time-response',
  }
}

// ── transitions ──────────────────────────────────────────────────────────────

export type ElectionTransition = 'open-candidate-registration' | 'open-voting' | 'close'

const TRANSITIONS: Record<ElectionTransition, { method: string; cacheField: string }> = {
  'open-candidate-registration': { method: 'openCandidateRegistration', cacheField: 'txHashes.opened' },
  'open-voting': { method: 'openVoting', cacheField: 'txHashes.votingOpened' },
  close: { method: 'closeElection', cacheField: 'txHashes.closed' },
}

export async function transitionElection(electionId: number, transition: ElectionTransition): Promise<ElectionDto> {
  const { method, cacheField } = TRANSITIONS[transition]
  await readChainElection(electionId) // 404 before attempting a transaction

  const receipt = await relay(`transition:${transition}`, method, [electionId])
  const chain = await readChainElection(electionId)

  const update: Record<string, unknown> = { [cacheField]: receipt.txHash, status: chain.status }
  if (transition === 'close') update.closedAt = new Date()
  await Election.updateOne({ chainElectionId: electionId }, { $set: update })

  const cached = await Election.findOne({ chainElectionId: electionId })
  return toElectionDto(chain, chain.description || (cached?.description ?? ''), await upazilaName(chain.upazilaId))
}
