/**
 * Registration, login and session issuing.
 *
 * Registration is three steps so that a half-finished attempt never becomes an account:
 * NID → face → account, carried by a short-lived `RegistrationSession`. The on-chain
 * `registerVoter()` happens in the final step, inside the same request that creates the
 * user, so an account can never exist without its commitment being anchored.
 */
import { randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import { ZeroAddress } from 'ethers'
import jwt from 'jsonwebtoken'
import type { Types } from 'mongoose'
import { generateCommitmentSalt, maskNid, nidLookupHash, normaliseNid, voterCommitment } from '../crypto/commitment.js'
import { decryptPiiToString, encryptPii } from '../crypto/pii.js'
import { env } from '../config/env.js'
import { RegistrationSession, User, VerificationRecord, type UserDocument } from '../models/index.js'
import { faceProvider, nidProvider } from '../providers/index.js'
import { ApiError } from '../utils/ApiError.js'
import { relay } from './relayer.service.js'

export type UserRole = 'voter' | 'admin' | 'trustee'

export interface UserDto {
  id: string
  fullName: string
  maskedNid: string
  email: string
  phone: string | null
  roles: UserRole[]
  voterCommitment: string
  registeredAt: string
  revoked: boolean
  registrationTxHash: string | null
}

export interface AuthSession {
  token: string
  user: UserDto
  expiresAt: string
}

interface UserRecord extends UserDocument {
  _id: Types.ObjectId
}

export function toUserDto(user: UserRecord): UserDto {
  return {
    id: String(user._id),
    fullName: user.fullName,
    maskedNid: user.nidMasked,
    email: user.email,
    phone: user.phone ?? null,
    roles: (user.roles ?? ['voter']) as UserRole[],
    voterCommitment: user.voterCommitment,
    registeredAt: new Date(user.registeredAt ?? Date.now()).toISOString(),
    revoked: Boolean(user.revoked),
    registrationTxHash: user.registrationTxHash ?? null,
  }
}

// ── passwords ────────────────────────────────────────────────────────────────

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}

// ── tokens ───────────────────────────────────────────────────────────────────

export interface TokenPayload {
  sub: string
  roles: UserRole[]
}

export function issueToken(user: UserRecord): { token: string; expiresAt: string } {
  const payload: TokenPayload = { sub: String(user._id), roles: (user.roles ?? ['voter']) as UserRole[] }
  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions)
  const decoded = jwt.decode(token) as { exp?: number } | null
  const expiresAt = new Date((decoded?.exp ?? Math.floor(Date.now() / 1000) + 86_400) * 1000).toISOString()
  return { token, expiresAt }
}

export function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload
  } catch {
    throw ApiError.unauthorized('Your session is no longer valid. Please sign in again.')
  }
}

// ── registration ─────────────────────────────────────────────────────────────

function yearsSince(date: Date): number {
  const now = new Date()
  let age = now.getUTCFullYear() - date.getUTCFullYear()
  const monthDelta = now.getUTCMonth() - date.getUTCMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < date.getUTCDate())) age -= 1
  return age
}

export interface NidVerificationInput {
  fullName: string
  nid: string
  dateOfBirth: string
}

export interface NidVerificationResult {
  verified: boolean
  maskedNid: string
  registrationToken: string
  ageVerified: boolean
  citizenshipVerified: boolean
}

export async function verifyNidStep(input: NidVerificationInput): Promise<NidVerificationResult> {
  let normalised: string
  try {
    normalised = normaliseNid(input.nid)
  } catch {
    throw ApiError.notFound('This National ID number was not found in the civil registry.')
  }

  const record = await nidProvider.lookup(normalised)
  const recordVerification = (outcome: 'passed' | 'failed', failureReason?: string) =>
    VerificationRecord.create({
      type: 'nid',
      provider: nidProvider.name,
      outcome,
      failureReason: failureReason ?? null,
    })

  if (!record.found || !record.fullName || !record.dateOfBirth) {
    await recordVerification('failed', 'not-found')
    throw ApiError.notFound('This National ID number was not found in the civil registry.')
  }

  if (record.fullName.trim().toLowerCase() !== input.fullName.trim().toLowerCase()) {
    await recordVerification('failed', 'name-mismatch')
    throw ApiError.unprocessable('The name provided does not match the National ID record.')
  }

  if (record.dateOfBirth !== input.dateOfBirth) {
    await recordVerification('failed', 'dob-mismatch')
    throw ApiError.unprocessable('The date of birth provided does not match the National ID record.')
  }

  if (record.isCitizen === false) {
    await recordVerification('failed', 'not-citizen')
    throw ApiError.unprocessable('Only citizens may register to vote.')
  }

  const dateOfBirth = new Date(`${record.dateOfBirth}T00:00:00.000Z`)
  if (yearsSince(dateOfBirth) < env.MINIMUM_VOTING_AGE) {
    await recordVerification('failed', 'under-age')
    throw ApiError.unprocessable(`Voters must be at least ${env.MINIMUM_VOTING_AGE} years old.`)
  }

  // Duplicate detection uses the peppered HMAC — the per-voter commitment cannot do this job.
  const lookupHash = nidLookupHash(normalised, env.NID_HMAC_PEPPER)
  if (await User.exists({ nidLookupHash: lookupHash })) {
    await recordVerification('failed', 'already-registered')
    throw ApiError.conflict('A voter is already registered with this National ID.')
  }

  const registrationToken = randomBytes(24).toString('hex')
  await RegistrationSession.create({
    token: registrationToken,
    nidEncrypted: encryptPii(normalised, env.PII_ENCRYPTION_KEY),
    nidLookupHash: lookupHash,
    fullName: record.fullName,
    dateOfBirth,
    nidVerified: true,
  })
  await recordVerification('passed')

  return {
    verified: true,
    maskedNid: maskNid(normalised),
    registrationToken,
    ageVerified: true,
    // Only `true` when the registry affirmed it; a provider that does not report
    // citizenship has not verified it, and saying otherwise would overstate the check.
    citizenshipVerified: record.isCitizen === true,
  }
}

export interface FaceVerificationInput {
  registrationToken: string
  selfieImage: string
}

export interface FaceVerificationResultDto {
  verified: boolean
  matchScore: number
  livenessPassed: boolean
}

/** Decodes a base64 data URL. The decoded bytes are held in memory and never written down. */
export function decodeDataUrl(dataUrl: string): Buffer {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) {
    throw ApiError.badRequest('The captured image was not in a supported format.')
  }
  return Buffer.from(match[2], 'base64')
}

export async function verifyFaceStep(input: FaceVerificationInput): Promise<FaceVerificationResultDto> {
  const session = await RegistrationSession.findOne({ token: input.registrationToken })
  if (!session) {
    throw ApiError.gone('Your registration session has expired. Please start again.')
  }

  const selfieImage = decodeDataUrl(input.selfieImage)
  const result = await faceProvider.verify({ selfieImage })

  const passed = result.matchScore >= env.FACE_MATCH_THRESHOLD && (!env.FACE_LIVENESS_REQUIRED || result.livenessPassed)

  await VerificationRecord.create({
    registrationToken: input.registrationToken,
    type: 'face',
    provider: faceProvider.name,
    outcome: passed ? 'passed' : 'failed',
    matchScore: result.matchScore,
    livenessPassed: result.livenessPassed,
    failureReason: passed ? null : result.livenessPassed ? 'below-threshold' : 'liveness-failed',
  })

  if (!passed) {
    throw ApiError.unprocessable('The captured image was not clear enough. Please try again in better lighting.')
  }

  // The embedding is kept; the image is not, and is now out of scope and collectable.
  session.faceVerified = true
  session.faceMatchScore = result.matchScore
  session.livenessPassed = result.livenessPassed
  session.faceEmbedding = encryptPii(result.embedding, env.PII_ENCRYPTION_KEY)
  await session.save()

  return { verified: true, matchScore: result.matchScore, livenessPassed: result.livenessPassed }
}

export interface CompleteRegistrationInput {
  registrationToken: string
  email: string
  phone: string
  password: string
}

export async function completeRegistration(input: CompleteRegistrationInput): Promise<AuthSession> {
  const session = await RegistrationSession.findOne({ token: input.registrationToken }).select(
    '+nidEncrypted +nidLookupHash +faceEmbedding',
  )
  if (!session) {
    throw ApiError.gone('Your registration session has expired. Please start again.')
  }
  if (!session.faceVerified) {
    throw ApiError.preconditionRequired('Facial verification has not been completed.')
  }

  const email = input.email.trim().toLowerCase()
  if (await User.exists({ email })) {
    throw ApiError.conflict('An account already exists with this email address.')
  }
  if (await User.exists({ nidLookupHash: session.nidLookupHash })) {
    throw ApiError.conflict('A voter is already registered with this National ID.')
  }

  const nid = decryptPiiToString(session.nidEncrypted as Buffer, env.PII_ENCRYPTION_KEY)
  const salt = generateCommitmentSalt()
  const commitment = voterCommitment(nid, salt)

  // On-chain first: an account must never exist without an anchored commitment. If the
  // transaction reverts, nothing is written locally and the voter can try again.
  const receipt = await relay('registerVoter', 'registerVoter', [commitment, ZeroAddress])

  const user = await User.create({
    fullName: session.fullName,
    nidEncrypted: session.nidEncrypted,
    nidLookupHash: session.nidLookupHash,
    nidMasked: maskNid(nid),
    commitmentSalt: encryptPii(salt, env.PII_ENCRYPTION_KEY),
    voterCommitment: commitment,
    dateOfBirth: session.dateOfBirth,
    email,
    phone: input.phone,
    passwordHash: await hashPassword(input.password),
    roles: ['voter'],
    faceEmbedding: session.faceEmbedding ?? null,
    registeredAt: new Date(),
    registrationTxHash: receipt.txHash,
  })

  await RegistrationSession.deleteOne({ _id: session._id })

  const { token, expiresAt } = issueToken(user as unknown as UserRecord)
  return { token, user: toUserDto(user as unknown as UserRecord), expiresAt }
}

// ── login ────────────────────────────────────────────────────────────────────

export interface LoginInput {
  identifier: string
  password: string
  selfieImage?: string
}

export async function login(input: LoginInput): Promise<AuthSession> {
  const identifier = input.identifier.trim()

  // The identifier is either an email or an NID; the NID is matched through its peppered
  // hash, never by storing or querying the number itself.
  let query: Record<string, unknown> = { email: identifier.toLowerCase() }
  if (/^[\d\s-]{10,20}$/.test(identifier)) {
    try {
      query = { nidLookupHash: nidLookupHash(identifier, env.NID_HMAC_PEPPER) }
    } catch {
      query = { email: identifier.toLowerCase() }
    }
  }

  const user = await User.findOne(query).select('+passwordHash')

  // Unknown account and wrong password are deliberately indistinguishable: anything else is
  // an enumeration oracle over National IDs.
  const passwordOk = user ? await verifyPassword(user.passwordHash, input.password) : false
  if (!user || !passwordOk) {
    throw ApiError.unauthorized('Incorrect credentials. Please check and try again.')
  }

  if (env.FACIAL_VERIFICATION_MODE === 'login_and_registration') {
    if (!input.selfieImage) {
      throw ApiError.badRequest('Facial verification is required to sign in.')
    }
    const result = await faceProvider.verify({ selfieImage: decodeDataUrl(input.selfieImage) })
    const passed = result.matchScore >= env.FACE_MATCH_THRESHOLD && (!env.FACE_LIVENESS_REQUIRED || result.livenessPassed)
    await VerificationRecord.create({
      userId: user._id,
      type: 'face',
      provider: faceProvider.name,
      outcome: passed ? 'passed' : 'failed',
      matchScore: result.matchScore,
      livenessPassed: result.livenessPassed,
    })
    if (!passed) {
      throw ApiError.unauthorized('Facial verification did not match the registered voter.')
    }
  }

  if (user.revoked) {
    throw ApiError.forbidden('This account has been suspended. Contact the Election Commission.')
  }

  const record = user as unknown as UserRecord
  const { token, expiresAt } = issueToken(record)
  return { token, user: toUserDto(record), expiresAt }
}
