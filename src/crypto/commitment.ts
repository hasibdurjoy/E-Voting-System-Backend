/**
 * NID derivations.
 *
 * A Bangladeshi NID is ~10–17 digits — a space small enough to exhaust in seconds. A bare
 * keccak256(nid) published anywhere, let alone on a public chain, is therefore reversible.
 * Two different derivations are needed because they have two different jobs:
 *
 *   nidLookupHash   HMAC under a server-held pepper. Deterministic across users, so it can
 *                   detect duplicates — and useless to anyone without the pepper.
 *                   NEVER goes on-chain.
 *   voterCommitment keccak256(nid ‖ per-voter salt). Unlinkable even to someone holding the
 *                   whole database, because the salt is fresh per voter. This is the only
 *                   identifier the chain ever sees — and it cannot be used for duplicate
 *                   detection, which is exactly why both exist.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { keccak256, toUtf8Bytes } from 'ethers'

/** Strips separators and validates the shape. Throws on anything that is not a plausible NID. */
export function normaliseNid(nid: string): string {
  const normalised = nid.replace(/[\s-]/g, '')
  if (!/^\d{10,17}$/.test(normalised)) throw new Error('National ID must be 10 to 17 digits')
  return normalised
}

/** Last four digits only: "•••• •••• 4821". The raw NID never reaches a response. */
export function maskNid(nid: string): string {
  const normalised = nid.replace(/[\s-]/g, '')
  return `•••• •••• ${normalised.slice(-4)}`
}

export function nidLookupHash(nid: string, pepper: string): string {
  return createHmac('sha256', pepper).update(normaliseNid(nid)).digest('hex')
}

export function generateCommitmentSalt(): Buffer {
  return randomBytes(32)
}

/** keccak256(nid ‖ salt) → 0x-prefixed 32 bytes. The on-chain voter identifier. */
export function voterCommitment(nid: string, salt: Buffer): string {
  return keccak256(Buffer.concat([Buffer.from(normaliseNid(nid), 'utf8'), salt]))
}

export interface CandidateProfile {
  electionId: number
  fullName: string
  party: string | null
  manifesto: string
  photoUrl: string | null
}

/**
 * keccak256 of a canonical serialisation — fixed field order, trimmed, NFC-normalised.
 * Without canonicalisation the anchor cannot be re-verified later, which defeats the point
 * of anchoring it.
 */
export function profileHash(profile: CandidateProfile): string {
  const canonical = [
    String(profile.electionId),
    profile.fullName.normalize('NFC').trim(),
    (profile.party ?? '').normalize('NFC').trim(),
    profile.manifesto.normalize('NFC').trim(),
    (profile.photoUrl ?? '').trim(),
  ].join('\u001f') // unit separator — cannot appear in any of the fields
  return keccak256(toUtf8Bytes(canonical))
}
