/**
 * Combining decryption shares and publishing the result.
 *
 * The combination happens off-chain because the arithmetic is on 4096-bit numbers, which
 * the EVM cannot do affordably. It is nonetheless verifiable by anyone: every ciphertext,
 * every partial decryption and the final totals are all on-chain, so an observer can repeat
 * this computation and check the published numbers.
 */
import { keccak256 } from 'ethers'
import { getReadOnlyContract } from '../blockchain/index.js'
import { BALLOT_BASE } from '../config/env.js'
import { hexToBigInt } from '../crypto/bigint.js'
import { deserialisePublicKey } from '../crypto/paillier.js'
import { combineShares, unpackTotals, type PartialDecryption } from '../crypto/threshold.js'
import { Candidate, DecryptionSession, Election, Trustee, User } from '../models/index.js'
import { CandidateStatus, ElectionStatus } from '../types/domain.js'
import { ApiError } from '../utils/ApiError.js'
import { logger } from '../utils/logger.js'
import { readChainElection } from './election.service.js'
import { relay } from './relayer.service.js'

export interface CandidateResultDto {
  candidateId: number
  fullName: string
  party: string | null
  ballotIndex: number
  votes: number
  percentage: number
}

export interface ElectionResultDto {
  electionId: number
  electionName: string
  published: boolean
  totalVotes: number
  results: CandidateResultDto[]
  publishTxHash: string | null
  publishedAt: string | null
  encryptedTallyHash: string
}

function factorial(value: number): bigint {
  let result = 1n
  for (let i = 2n; i <= BigInt(value); i++) result *= i
  return result
}

/** Approved candidates in ballot-index order — the order the totals are reported in. */
async function approvedCandidates(electionId: number): Promise<{ candidateId: number; ballotIndex: number; fullName: string; party: string | null }[]> {
  const contract = getReadOnlyContract()
  const ids = (await contract.getApprovedCandidates(electionId)) as bigint[]

  const rows = await Candidate.find({ chainElectionId: electionId })
  const byChainId = new Map(rows.map((row) => [row.chainCandidateId, row]))
  const users = await User.find({ _id: { $in: rows.map((row) => row.userId) } })
  const nameById = new Map(users.map((user) => [String(user._id), user.fullName]))

  return Promise.all(
    ids.map(async (rawId) => {
      const candidateId = Number(rawId)
      const row = byChainId.get(candidateId)
      const chain = (await contract.getCandidate(electionId, candidateId)) as { ballotIndex: bigint }
      return {
        candidateId,
        ballotIndex: Number(chain.ballotIndex),
        fullName: row ? (nameById.get(String(row.userId)) ?? 'Unknown candidate') : 'Unknown candidate',
        party: row?.party ?? null,
      }
    }),
  )
}

export async function publishResult(electionId: number): Promise<ElectionResultDto> {
  const chain = await readChainElection(electionId)

  if (chain.status === ElectionStatus.ResultsPublished) {
    throw ApiError.conflict('The result for this election has already been published.')
  }
  if (chain.status !== ElectionStatus.Closed) {
    throw ApiError.conflict('Only a closed election can have its result published.')
  }
  // The contract refuses too — that refusal is the real guarantee; this is the readable one.
  if (chain.decryptionShareCount < chain.trusteeThreshold) {
    throw ApiError.conflict(
      `Only ${chain.decryptionShareCount} of the required ${chain.trusteeThreshold} decryption shares have been submitted.`,
    )
  }

  const contract = getReadOnlyContract()
  const [n] = (await contract.getElectionKey(electionId)) as [string, string]
  const publicKey = deserialisePublicKey(n)

  // Collect the partial decryptions the trustees submitted, each tagged with the Shamir
  // index it was computed under. The index comes from setup, never from the submitter.
  const trustees = await Trustee.find({ chainElectionId: electionId })
  const partials: PartialDecryption[] = []
  for (const trustee of trustees) {
    const submitted = (await contract.hasSubmittedShare(electionId, trustee.address)) as boolean
    if (!submitted) continue
    const share = (await contract.getDecryptionShare(electionId, trustee.address)) as string
    partials.push({ index: trustee.shareIndex, value: hexToBigInt(share) })
  }

  if (partials.length < chain.trusteeThreshold) {
    throw ApiError.conflict('Not enough trustees have submitted their decryption share yet.')
  }

  const delta = factorial(chain.trusteeCount)
  const candidates = await approvedCandidates(electionId)

  let totals: number[]
  try {
    const packed = combineShares(partials, delta, publicKey, chain.trusteeThreshold)
    totals = unpackTotals(packed, candidates.length, BALLOT_BASE)
  } catch (error) {
    logger.error('Threshold combination failed', error instanceof Error ? error.message : error)
    throw ApiError.internal('The decryption shares could not be combined. The result has not been published.')
  }

  // A sanity check against the public ballot count. A mismatch means a malformed ballot was
  // accepted (the contract cannot verify ballot well-formedness) — publishing anyway would
  // put a wrong number on-chain permanently.
  const totalVotes = totals.reduce((sum, votes) => sum + votes, 0)
  if (totalVotes !== chain.voteCount) {
    logger.error(`Tally mismatch for election ${electionId}: decrypted ${totalVotes}, chain recorded ${chain.voteCount}`)
    throw ApiError.internal(
      'The decrypted tally does not match the number of ballots recorded. The result has not been published.',
    )
  }

  const receipt = await relay('publishResult', 'publishResult', [electionId, totals.map((value) => BigInt(value))])

  await DecryptionSession.updateOne(
    { chainElectionId: electionId },
    { $set: { combinedAt: new Date(), totals, publishTxHash: receipt.txHash } },
  )
  await Election.updateOne(
    { chainElectionId: electionId },
    { $set: { status: ElectionStatus.ResultsPublished, 'txHashes.published': receipt.txHash } },
  )

  return getResults(electionId)
}

export async function getResults(electionId: number): Promise<ElectionResultDto> {
  const chain = await readChainElection(electionId)
  if (chain.status !== ElectionStatus.ResultsPublished) {
    throw ApiError.conflict('Results for this election have not been published yet.')
  }

  const contract = getReadOnlyContract()
  const totals = ((await contract.getResult(electionId)) as bigint[]).map(Number)
  const encryptedTally = (await contract.getEncryptedTally(electionId)) as string
  const candidates = await approvedCandidates(electionId)
  const session = await DecryptionSession.findOne({ chainElectionId: electionId })
  const cached = await Election.findOne({ chainElectionId: electionId })

  const totalVotes = totals.reduce((sum, votes) => sum + votes, 0)
  const results: CandidateResultDto[] = candidates
    .map((candidate) => {
      const votes = totals[candidate.ballotIndex] ?? 0
      return {
        candidateId: candidate.candidateId,
        fullName: candidate.fullName,
        party: candidate.party,
        ballotIndex: candidate.ballotIndex,
        votes,
        percentage: totalVotes === 0 ? 0 : Math.round((votes / totalVotes) * 1000) / 10,
      }
    })
    .sort((a, b) => b.votes - a.votes)

  return {
    electionId,
    electionName: chain.name,
    published: true,
    totalVotes,
    results,
    publishTxHash: session?.publishTxHash ?? cached?.txHashes?.published ?? null,
    publishedAt: session?.combinedAt ? session.combinedAt.toISOString() : null,
    encryptedTallyHash: keccak256(encryptedTally),
  }
}

/** Candidate status filter used by the admin dashboard. */
export const PENDING_CANDIDATE_STATUS = CandidateStatus.Pending
