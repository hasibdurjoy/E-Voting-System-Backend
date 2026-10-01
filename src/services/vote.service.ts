/**
 * Casting a ballot — the most security-critical path in the system.
 *
 * Three rules shape everything here:
 *
 *   1. EVERY eligibility rule is re-checked server-side, and then again by the contract.
 *      The client's own assessment is a UI convenience and is never trusted.
 *   2. The ciphertext is OPAQUE. The backend validates its shape, relays it, and stores a
 *      hash. It never decrypts it, never logs it next to a user id, and could not read it
 *      if it wanted to — the decryption key was split across trustees at setup.
 *   3. A rejected vote is terminal. `AlreadyVoted` becomes a 409 and the UI suppresses the
 *      retry button, because a retry can only fail again.
 */
import { randomBytes } from 'node:crypto'
import { keccak256 } from 'ethers'
import { getChainTime, getReadOnlyContract } from '../blockchain/index.js'
import { hexToBigInt } from '../crypto/bigint.js'
import { isVotingOpen } from '../mappers/chain.mapper.js'
import type { AuthenticatedUser } from '../middleware/auth.js'
import { Election, VoteReceipt } from '../models/index.js'
import type { IneligibilityReason } from '../types/domain.js'
import { ApiError } from '../utils/ApiError.js'
import { readChainElection } from './election.service.js'
import { relay } from './relayer.service.js'

export interface VoteReceiptDto {
  electionId: number
  receiptCode: string
  txHash: string
  blockNumber: number | null
  ciphertextHash: string
  castAt: string
  confirmed: boolean
}

export interface EligibilityResultDto {
  eligible: boolean
  reason: IneligibilityReason | null
  hasVoted: boolean
  receipt: VoteReceiptDto | null
}

interface ReceiptRow {
  chainElectionId: number
  receiptCode: string
  txHash: string
  blockNumber?: number | null
  ciphertextHash: string
  castAt?: Date | null
  confirmed?: boolean | null
}

function toReceiptDto(row: ReceiptRow): VoteReceiptDto {
  return {
    electionId: row.chainElectionId,
    receiptCode: row.receiptCode,
    txHash: row.txHash,
    blockNumber: row.blockNumber ?? null,
    ciphertextHash: row.ciphertextHash,
    castAt: (row.castAt ?? new Date()).toISOString(),
    confirmed: Boolean(row.confirmed),
  }
}

/** Short, human-checkable: the voter can read it down a phone line. */
function generateReceiptCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1
  const bytes = randomBytes(8)
  const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`
}

/**
 * The single source of eligibility. The ballot page, the eligibility endpoint and the vote
 * endpoint all call this, so they cannot disagree with each other.
 */
export async function checkEligibility(
  user: AuthenticatedUser | undefined,
  electionId: number,
): Promise<EligibilityResultDto> {
  if (!user) {
    return { eligible: false, reason: 'not-authenticated', hasVoted: false, receipt: null }
  }

  const contract = getReadOnlyContract()
  const chain = await readChainElection(electionId)

  const existing = await VoteReceipt.findOne({ chainElectionId: electionId, userId: user._id })
  const hasVotedOnChain = (await contract.hasVoted(electionId, user.voterCommitment)) as boolean
  const receipt = existing ? toReceiptDto(existing) : null

  if (user.revoked) return { eligible: false, reason: 'account-revoked', hasVoted: hasVotedOnChain, receipt }

  const registered = (await contract.isRegisteredVoter(user.voterCommitment)) as boolean
  if (!registered) return { eligible: false, reason: 'not-registered', hasVoted: hasVotedOnChain, receipt }

  if (hasVotedOnChain) return { eligible: false, reason: 'already-voted', hasVoted: true, receipt }

  // Judged by the chain's clock, because that is what the contract will check.
  if (!isVotingOpen(chain, await getChainTime())) {
    return { eligible: false, reason: 'election-not-open', hasVoted: false, receipt }
  }

  return { eligible: true, reason: null, hasVoted: false, receipt }
}

export interface CastVoteInput {
  electionId: number
  ciphertext: string
}

export async function castVote(user: AuthenticatedUser, input: CastVoteInput): Promise<VoteReceiptDto> {
  const { electionId, ciphertext } = input

  // 1 ── eligibility, re-derived from the chain rather than taken from the request
  const eligibility = await checkEligibility(user, electionId)
  if (!eligibility.eligible) {
    switch (eligibility.reason) {
      case 'already-voted':
        throw ApiError.conflict('You have already voted in this election. A ballot cannot be changed once cast.')
      case 'account-revoked':
        throw ApiError.forbidden('This account has been suspended. Contact the Election Commission.')
      case 'not-registered':
        throw ApiError.forbidden('This account is not registered to vote.')
      default:
        throw ApiError.conflict('This election is not currently open for voting.')
    }
  }

  // 2 ── the ciphertext must be exactly len(n²) bytes and numerically below n², which is
  //      what the contract checks. Catching it here turns a wasted transaction into a 400.
  const contract = getReadOnlyContract()
  const [n, nSquared] = (await contract.getElectionKey(electionId)) as [string, string]
  if (!nSquared || nSquared === '0x') {
    throw ApiError.conflict('This election has no encryption key yet.')
  }
  if (!/^0x[0-9a-fA-F]+$/.test(ciphertext) || ciphertext.length % 2 !== 0) {
    throw ApiError.badRequest('The ballot was rejected because it was malformed.')
  }
  const expectedBytes = (nSquared.length - 2) / 2
  const actualBytes = (ciphertext.length - 2) / 2
  if (actualBytes !== expectedBytes) {
    throw ApiError.badRequest('The ballot was rejected because it was malformed.')
  }
  if (hexToBigInt(ciphertext) >= hexToBigInt(nSquared)) {
    throw ApiError.badRequest('The ballot was rejected because it was malformed.')
  }
  void n

  // 3 ── relay. Never retried automatically: a revert here is final.
  const receipt = await relay('castVote', 'castVote', [electionId, user.voterCommitment, ciphertext])

  const ciphertextHash = keccak256(ciphertext)
  const election = await Election.findOne({ chainElectionId: electionId })
  if (!election) {
    // The ballot is already on-chain at this point, so the vote itself is safe; what is
    // missing is the local cache row, which means this backend did not create the election.
    throw ApiError.internal('Your ballot was recorded on the blockchain, but the receipt could not be saved.')
  }

  // 4 ── persist the receipt. The ciphertext itself is deliberately NOT stored: the hash is
  //      enough for the voter to find their ballot on-chain, and reveals nothing.
  const row = await VoteReceipt.create({
    electionId: election._id,
    chainElectionId: electionId,
    userId: user._id,
    receiptCode: generateReceiptCode(),
    txHash: receipt.txHash,
    blockNumber: receipt.blockNumber,
    ciphertextHash,
    castAt: new Date(),
    confirmed: true,
  })

  return toReceiptDto(row)
}

export async function listMyReceipts(user: AuthenticatedUser): Promise<VoteReceiptDto[]> {
  const rows = await VoteReceipt.find({ userId: user._id }).sort({ castAt: -1 })
  return rows.map(toReceiptDto)
}
