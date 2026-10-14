/**
 * Decoding of contract structs.
 *
 * ethers returns a `Result` whose named fields are typed `any`, so everything crosses into
 * TypeScript here and nowhere else. Timestamps are uint64 **seconds** on-chain and ISO
 * strings in the API — mixing the two up is the classic source of elections that open in
 * 1970 or in the year 56000.
 */
import { ElectionStatus } from '../types/domain.js'

export interface ChainElection {
  id: number
  name: string
  description: string
  /** The Upazila this election belongs to; 0 means it is open to every area. */
  upazilaId: number
  candidateRegistrationEnd: Date
  startTime: Date
  endTime: Date
  status: number
  candidateCount: number
  approvedCandidateCount: number
  voteCount: number
  trusteeCount: number
  trusteeThreshold: number
  decryptionShareCount: number
}

export interface ChainCandidate {
  id: number
  ballotIndex: number
  voterCommitment: string
  profileHash: string
  status: number
}

export interface ChainVoter {
  commitment: string
  wallet: string
  /** The voter's area tag — the eligibility rule, not personal data. */
  upazilaId: number
  registeredAt: Date
  revoked: boolean
  /** True while a dispute over this voter's record is unresolved. */
  onHold: boolean
}

type Indexed = Record<string | number, unknown>

function num(value: unknown): number {
  return Number(value as bigint | number)
}

function secondsToDate(value: unknown): Date {
  return new Date(num(value) * 1000)
}

export function dateToSeconds(value: Date | string): bigint {
  const date = value instanceof Date ? value : new Date(value)
  return BigInt(Math.floor(date.getTime() / 1000))
}

export function toChainElection(raw: unknown): ChainElection {
  const r = raw as Indexed
  return {
    id: num(r.id),
    name: String(r.name),
    description: String(r.description),
    upazilaId: num(r.upazilaId),
    candidateRegistrationEnd: secondsToDate(r.candidateRegistrationEnd),
    startTime: secondsToDate(r.startTime),
    endTime: secondsToDate(r.endTime),
    status: num(r.status),
    candidateCount: num(r.candidateCount),
    approvedCandidateCount: num(r.approvedCandidateCount),
    voteCount: num(r.voteCount),
    trusteeCount: num(r.trusteeCount),
    trusteeThreshold: num(r.trusteeThreshold),
    decryptionShareCount: num(r.decryptionShareCount),
  }
}

export function toChainCandidate(raw: unknown): ChainCandidate {
  const r = raw as Indexed
  return {
    id: num(r.id),
    ballotIndex: num(r.ballotIndex),
    voterCommitment: String(r.voterCommitment),
    profileHash: String(r.profileHash),
    status: num(r.status),
  }
}

export function toChainVoter(raw: unknown): ChainVoter {
  const r = raw as Indexed
  return {
    commitment: String(r.commitment),
    wallet: String(r.wallet),
    upazilaId: num(r.upazilaId),
    registeredAt: secondsToDate(r.registeredAt),
    revoked: Boolean(r.revoked),
    onHold: Boolean(r.onHold),
  }
}

/** Voting is open only inside the window AND in the Voting state — both, never either. */
export function isVotingOpen(election: ChainElection, now = new Date()): boolean {
  return election.status === ElectionStatus.Voting && now >= election.startTime && now < election.endTime
}
