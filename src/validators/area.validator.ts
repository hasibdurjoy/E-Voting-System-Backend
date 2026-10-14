import { z } from 'zod'

export const registerUpazilaSchema = z.object({
  upazilaId: z.coerce.number().int().positive('An Upazila code must be a positive number'),
  name: z.string().trim().min(2).max(120),
  district: z.string().trim().max(120).optional(),
})

export const transferRequestSchema = z.object({
  toUpazilaId: z.coerce.number().int().positive(),
  evidence: z.string().trim().min(5, 'Describe the proof of your new address').max(2000),
})

export const transferDecisionSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().max(500).optional(),
})

export const disputeSchema = z.object({
  category: z.enum(['wrong-area', 'wrong-personal-details', 'wrongly-revoked', 'duplicate-registration', 'other']),
  detail: z.string().trim().min(10, 'Please describe the problem in at least 10 characters').max(2000),
  /** Admins may raise a dispute about another voter; voters may not. */
  subjectUserId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
})

export const disputeResolutionSchema = z.object({
  outcome: z.enum(['upheld', 'rejected']),
  resolution: z.string().trim().min(5, 'Record how the dispute was resolved').max(2000),
  correctedUpazilaId: z.coerce.number().int().positive().optional(),
})

export const objectIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
})
