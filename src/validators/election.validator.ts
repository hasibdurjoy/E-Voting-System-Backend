import { z } from 'zod'
import { CandidateStatus } from '../types/domain.js'

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Must be an ISO 8601 date')

export const electionIdParam = z.object({
  id: z.coerce.number().int().positive('Election ids are 1-based'),
})

export const createElectionSchema = z.object({
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).default(''),
  candidateRegistrationEnd: isoDate,
  startTime: isoDate,
  endTime: isoDate,
  // Shape only. "threshold >= 2" and "threshold <= count" are semantic rules, so they are
  // enforced in the service and reported as 422, matching the contract's InvalidTrusteeSet.
  trusteeThreshold: z.coerce.number().int().positive(),
  trusteeCount: z.coerce.number().int().positive().max(20),
})

export const transitionSchema = z.object({
  transition: z.enum(['open-candidate-registration', 'open-voting', 'close']),
})

export const candidateApplicationSchema = z.object({
  electionId: z.coerce.number().int().positive(),
  party: z.string().trim().max(120).default(''),
  manifesto: z.string().trim().min(10, 'Describe your platform in at least 10 characters').max(5000),
  photoUrl: z.url().max(500).optional(),
})

export const candidateDecisionSchema = z.object({
  electionId: z.coerce.number().int().positive(),
  status: z.literal([CandidateStatus.Approved, CandidateStatus.Rejected]),
  reason: z.string().trim().max(500).optional(),
})

export const castVoteSchema = z.object({
  electionId: z.coerce.number().int().positive(),
  ciphertext: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, 'The ballot was rejected because it was malformed.')
    // 2048-bit keys make this 512 bytes; the exact width is checked against the election key.
    .max(4098, 'The ballot was rejected because it was malformed.'),
})

export const candidateIdParam = z.object({
  id: z.coerce.number().int().positive(),
})

export const voterIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid voter id'),
})
