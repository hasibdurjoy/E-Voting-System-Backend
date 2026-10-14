/**
 * Maps the contract's custom errors onto HTTP responses.
 *
 * ethers decodes custom errors automatically when the full JSON ABI is loaded, which is why
 * `sync:contracts` ships the JSON form. Raw revert data is never shown to a user: it is
 * logged server-side and translated into one of the messages below.
 *
 * The table mirrors §6 of the contracts INTEGRATION guide. A `500` here means "the backend
 * sent something it should have caught first" — a bug, not a user mistake.
 */
import { Interface } from 'ethers'
import { ApiError } from '../utils/ApiError.js'
import { logger } from '../utils/logger.js'
import { VOTING_REGISTRY_ABI } from './abi/index.js'

interface Mapping {
  status: number
  /** User-facing. It is rendered verbatim, so it is written for a voter. */
  message: string
}

const ERROR_MAP: Record<string, Mapping> = {
  AccessControlUnauthorizedAccount: { status: 500, message: 'The service is not authorised to perform this action. An administrator has been notified.' },
  VoterAlreadyRegistered: { status: 409, message: 'A voter is already registered with this National ID.' },
  VoterNotRegistered: { status: 403, message: 'This account is not registered to vote.' },
  VoterRevokedError: { status: 409, message: 'This voter registration has already been revoked.' },
  VoterOnHoldError: { status: 403, message: 'Your registration is on hold while a dispute about your record is reviewed.' },
  UnknownUpazila: { status: 422, message: 'That Upazila is not registered.' },
  UpazilaAlreadyRegistered: { status: 409, message: 'That Upazila has already been registered.' },
  EmptyUpazilaName: { status: 422, message: 'An Upazila needs a name.' },
  AreaUnchanged: { status: 409, message: 'This voter is already registered in that Upazila.' },
  WrongUpazila: { status: 403, message: 'This election is held in a different Upazila from the one you are registered in.' },
  EmptyCommitment: { status: 500, message: 'The registration could not be completed. Please try again.' },
  AlreadyVoted: { status: 409, message: 'You have already voted in this election. A ballot cannot be changed once cast.' },
  ElectionNotFound: { status: 404, message: 'That election does not exist.' },
  UnexpectedElectionStatus: { status: 409, message: 'The election is not in the right state for that action.' },
  ElectionNotOpen: { status: 409, message: 'Voting is not open for this election.' },
  ElectionNotEnded: { status: 409, message: 'This election cannot be closed before its end time.' },
  NoApprovedCandidates: { status: 409, message: 'Voting cannot open until at least one candidate has been approved.' },
  CandidateNotFound: { status: 404, message: 'That candidate application does not exist.' },
  CandidateAlreadyRegistered: { status: 409, message: 'You have already applied as a candidate in this election.' },
  CandidateNotPending: { status: 409, message: 'This application has already been decided.' },
  InvalidCandidateStatus: { status: 400, message: 'That candidate decision is not valid.' },
  InvalidElectionPeriod: { status: 422, message: 'The election dates are not valid.' },
  InvalidPublicKey: { status: 500, message: 'The election key could not be configured. Please try again.' },
  PublicKeyNotConfigured: { status: 409, message: 'This election has no encryption key yet.' },
  InvalidTrusteeSet: { status: 422, message: 'The trustee configuration is not valid. At least two trustees and a threshold of two are required.' },
  InvalidCiphertextLength: { status: 400, message: 'The ballot was rejected because it was malformed.' },
  CiphertextNotReduced: { status: 400, message: 'The ballot was rejected because it was malformed.' },
  NotAnElectionTrustee: { status: 403, message: 'You are not a trustee of this election.' },
  DecryptionShareAlreadySubmitted: { status: 409, message: 'You have already submitted your decryption share.' },
  EmptyDecryptionShare: { status: 400, message: 'The decryption share was empty.' },
  ThresholdNotReached: { status: 409, message: 'Not enough trustees have submitted their decryption share yet.' },
  ResultLengthMismatch: { status: 500, message: 'The result could not be published. Please try again.' },
  LengthMismatch: { status: 500, message: 'The request could not be processed.' },
  ModulusNotOdd: { status: 500, message: 'The request could not be processed.' },
  ModExpFailed: { status: 500, message: 'The request could not be processed.' },
}

interface EthersRevert {
  revert?: { name?: string; args?: unknown[] } | null
  data?: unknown
  error?: { data?: unknown } | null
  info?: { error?: { data?: unknown | { data?: unknown } } } | null
  shortMessage?: string
  code?: string
  reason?: string
}

const contractInterface = new Interface(VOTING_REGISTRY_ABI)

/**
 * Digs the revert payload out of an ethers error.
 *
 * ethers only populates `revert` when the failure came back from a call it decoded itself.
 * A revert raised during gas estimation arrives as raw `data` on one of several nested
 * shapes instead, so relying on `revert` alone silently downgrades a precise 409 into a
 * generic 502 — which is exactly the kind of mismapping the status codes exist to prevent.
 */
function extractRevertData(error: unknown): string | null {
  const candidate = error as EthersRevert | null
  const nested = candidate?.info?.error as { data?: unknown } | undefined
  const sources = [candidate?.data, candidate?.error?.data, nested?.data]

  for (const source of sources) {
    if (typeof source === 'string' && source.startsWith('0x') && source.length >= 10) return source
    if (source && typeof source === 'object' && 'data' in source) {
      const inner = (source as { data?: unknown }).data
      if (typeof inner === 'string' && inner.startsWith('0x') && inner.length >= 10) return inner
    }
  }
  return null
}

/** The custom error name, whether ethers decoded it or only handed back the raw data. */
export function decodeContractErrorName(error: unknown): string | null {
  const revert = (error as EthersRevert | null)?.revert
  if (revert?.name) return revert.name

  const data = extractRevertData(error)
  if (!data) return null
  try {
    return contractInterface.parseError(data)?.name ?? null
  } catch {
    return null
  }
}

/** True for the "someone else used that nonce" family of send failures. */
export function isNonceError(error: unknown): boolean {
  const candidate = error as EthersRevert | null
  if (candidate?.code === 'NONCE_EXPIRED' || candidate?.code === 'REPLACEMENT_UNDERPRICED') return true
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('nonce has already been used') || message.includes('nonce too low')
}

/**
 * Translates a failed contract call into an ApiError. Anything unrecognised becomes a 502:
 * the chain refused and we do not know why, which is not something to report as success.
 */
export function toApiError(error: unknown, context: string): ApiError {
  const name = decodeContractErrorName(error)

  if (name && ERROR_MAP[name]) {
    const { status, message } = ERROR_MAP[name]
    // The detail (including arguments) stays server-side.
    logger.warn(`${context}: contract reverted with ${name}`)
    return new ApiError(status, message, undefined)
  }

  const detail = error instanceof Error ? error.message : String(error)
  logger.error(`${context}: unmapped chain failure`, detail)

  if (name) return new ApiError(502, 'The blockchain rejected this action. Please try again or contact support.')
  return new ApiError(502, 'The blockchain could not be reached. Please try again shortly.')
}

export const CONTRACT_ERROR_STATUS = ERROR_MAP
