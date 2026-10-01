/**
 * Trustee operations.
 *
 * DESIGN DECISION — where the partial decryption happens (root INTEGRATION.md §5.1):
 * it happens on the TRUSTEE'S OWN MACHINE, with the trustee's own key, and the backend
 * never sees the key share. That is the only arrangement under which "no single party can
 * decrypt" is true rather than decorative.
 *
 * Mechanically it is also the only arrangement the contract permits:
 * `submitDecryptionShare` requires `msg.sender` to be a trustee of that election, so the
 * backend relayer cannot send it on a trustee's behalf even if it wanted to.
 *
 * The trustee therefore runs `yarn trustee:share` (see `src/tools/trustee-client.ts`),
 * which fetches the aggregate, computes cᵢ = c^{2Δsᵢ} locally and submits it. This endpoint
 * reconciles that submission for the UI: until the chain shows the share, it answers 428
 * rather than pretending to do the work.
 */
import { keccak256 } from 'ethers'
import { getReadOnlyContract } from '../blockchain/index.js'
import { BALLOT_BASE } from '../config/env.js'
import type { AuthenticatedUser } from '../middleware/auth.js'
import { DecryptionSession, Election, Trustee } from '../models/index.js'
import { ApiError } from '../utils/ApiError.js'
import { readChainElection, type PaillierPublicKeyDto } from './election.service.js'

export interface TrusteeElectionDto {
  electionId: number
  electionName: string
  status: number
  closedAt: string | null
  voteCount: number
  trusteeThreshold: number
  decryptionShareCount: number
  hasSubmittedShare: boolean
}

export interface EncryptedTallyDto {
  electionId: number
  ciphertext: string
  ciphertextHash: string
  voteCount: number
  publicKey: PaillierPublicKeyDto
}

export interface DecryptionShareSubmissionDto {
  electionId: number
  share: string
  txHash: string
  sharesSoFar: number
  thresholdReached: boolean
}

/** The address a trustee signs with. Without one they cannot act as a trustee at all. */
function trusteeAddress(user: AuthenticatedUser): string {
  if (!user.walletAddress) {
    throw ApiError.forbidden('No signing address is registered for this trustee account.')
  }
  return user.walletAddress.toLowerCase()
}

export async function listTrusteeElections(user: AuthenticatedUser): Promise<TrusteeElectionDto[]> {
  const address = trusteeAddress(user)
  const memberships = await Trustee.find({ address })
  if (memberships.length === 0) return []

  const contract = getReadOnlyContract()
  const results = await Promise.all(
    memberships.map(async (membership) => {
      const chain = await readChainElection(membership.chainElectionId)
      const cached = await Election.findOne({ chainElectionId: membership.chainElectionId })
      const hasSubmittedShare = (await contract.hasSubmittedShare(membership.chainElectionId, address)) as boolean
      return {
        electionId: chain.id,
        electionName: chain.name,
        status: chain.status,
        closedAt: cached?.closedAt ? cached.closedAt.toISOString() : null,
        voteCount: chain.voteCount,
        trusteeThreshold: chain.trusteeThreshold,
        decryptionShareCount: chain.decryptionShareCount,
        hasSubmittedShare,
      }
    }),
  )
  return results
}

/** Locates the trustee's own submission transaction. Absent is not fatal — it is cosmetic. */
async function findShareTxHash(electionId: number, address: string): Promise<string> {
  try {
    const contract = getReadOnlyContract()
    const filter = contract.filters.DecryptionShareSubmitted(electionId, address)
    const events = await contract.queryFilter(filter, 0, 'latest')
    return events.at(-1)?.transactionHash ?? ''
  } catch {
    return ''
  }
}

async function assertElectionTrustee(electionId: number, address: string): Promise<void> {
  const contract = getReadOnlyContract()
  const isTrustee = (await contract.isElectionTrustee(electionId, address)) as boolean
  if (!isTrustee) throw ApiError.forbidden('You are not a trustee of this election.')
}

export async function getEncryptedTally(user: AuthenticatedUser, electionId: number): Promise<EncryptedTallyDto> {
  const address = trusteeAddress(user)
  await assertElectionTrustee(electionId, address)

  const chain = await readChainElection(electionId)
  const contract = getReadOnlyContract()
  const ciphertext = (await contract.getEncryptedTally(electionId)) as string
  const [n, nSquared] = (await contract.getElectionKey(electionId)) as [string, string]

  return {
    electionId,
    ciphertext,
    ciphertextHash: keccak256(ciphertext),
    voteCount: chain.voteCount,
    publicKey: { n, nSquared, ballotBase: BALLOT_BASE.toString() },
  }
}

/**
 * Reconciles the trustee's on-chain submission.
 *
 * It deliberately does NOT accept a share in the request body: a share arriving here would
 * mean the share had left the trustee's machine, which is the exact failure this design
 * avoids.
 */
export async function recordShareSubmission(
  user: AuthenticatedUser,
  electionId: number,
): Promise<DecryptionShareSubmissionDto> {
  const address = trusteeAddress(user)
  await assertElectionTrustee(electionId, address)

  const chain = await readChainElection(electionId)
  const contract = getReadOnlyContract()
  const submitted = (await contract.hasSubmittedShare(electionId, address)) as boolean

  if (!submitted) {
    throw ApiError.preconditionRequired(
      'Your decryption share has not been submitted yet. Run your trustee client to compute and ' +
        'submit it with your own key — your key share must never be sent to this server.',
    )
  }

  const share = (await contract.getDecryptionShare(electionId, address)) as string

  // The transaction hash comes from the event the trustee's own submission emitted.
  const txHash = await findShareTxHash(electionId, address)

  const membership = await Trustee.findOne({ chainElectionId: electionId, address })
  if (membership && !membership.shareSubmittedAt) {
    membership.shareSubmittedAt = new Date()
    membership.shareTxHash = txHash || null
    await membership.save()
  }

  await DecryptionSession.updateOne(
    { chainElectionId: electionId },
    {
      $set: { sharesSubmitted: chain.decryptionShareCount },
      $addToSet: {
        shares: {
          trusteeAddress: address,
          shareIndex: membership?.shareIndex ?? 0,
          txHash: txHash || null,
          submittedAt: membership?.shareSubmittedAt ?? new Date(),
        },
      },
    },
  )

  return {
    electionId,
    share,
    txHash,
    sharesSoFar: chain.decryptionShareCount,
    thresholdReached: chain.decryptionShareCount >= chain.trusteeThreshold,
  }
}
