/**
 * Per-route rate limits.
 *
 * The global 100-per-15-minutes limiter is far too loose for anything that guesses at a
 * credential: five attempts is plenty, and the key includes the submitted identifier so
 * that rotating IP addresses does not reset the budget.
 */
import { rateLimit, type Options } from 'express-rate-limit'
import type { Request } from 'express'
import { env, isTest } from '../config/env.js'

const message = { success: false, message: 'Too many attempts. Please wait a few minutes and try again.' }

function limiter(options: Partial<Options>) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message,
    // Limits are disabled under test so a suite can exercise a flow repeatedly; they are
    // verified by a dedicated test that enables them explicitly.
    skip: () => isTest,
    ...options,
  })
}

/** Keyed by IP *and* by the identifier being attacked. */
function identifierKey(field: string) {
  return (req: Request): string => {
    const body = req.body as Record<string, unknown> | undefined
    const value = typeof body?.[field] === 'string' ? (body[field] as string) : ''
    return `${req.ip ?? 'unknown'}:${value.trim().toLowerCase()}`
  }
}

export const loginLimiter = limiter({ limit: env.AUTH_RATE_LIMIT_MAX, keyGenerator: identifierKey('identifier') })
export const nidVerificationLimiter = limiter({ limit: env.AUTH_RATE_LIMIT_MAX, keyGenerator: identifierKey('nid') })
export const registrationLimiter = limiter({ limit: env.REGISTRATION_RATE_LIMIT_MAX })
/** Voting is one-shot per election, so this only needs to stop scripted abuse. */
export const voteLimiter = limiter({ limit: env.VOTE_RATE_LIMIT_MAX })
