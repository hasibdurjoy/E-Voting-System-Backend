/**
 * Domain enums, mirrored NUMERICALLY from the Solidity contract and from the frontend's
 * `src/types/domain.ts`. All three must agree: reordering a value here silently reassigns
 * the meaning of every stored status.
 *
 * Source of truth: e-voting-system-smart-contracts/contracts/VotingRegistry.sol
 */

export const ElectionStatus = {
  Draft: 0,
  CandidateRegistration: 1,
  Voting: 2,
  Closed: 3,
  ResultsPublished: 4,
} as const
export type ElectionStatus = (typeof ElectionStatus)[keyof typeof ElectionStatus]

export const CandidateStatus = {
  None: 0,
  Pending: 1,
  Approved: 2,
  Rejected: 3,
  Withdrawn: 4,
} as const
export type CandidateStatus = (typeof CandidateStatus)[keyof typeof CandidateStatus]

export type UserRole = 'voter' | 'admin' | 'trustee'

export type IneligibilityReason =
  | 'not-authenticated'
  | 'not-registered'
  | 'account-revoked'
  | 'election-not-open'
  | 'already-voted'
