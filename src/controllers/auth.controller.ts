import type { Request, RequestHandler, Response } from 'express'
import { env } from '../config/env.js'
import { currentUser } from '../middleware/auth.js'
import { audit } from '../services/audit.service.js'
import {
  completeRegistration,
  login,
  toUserDtoWithArea,
  verifyFaceStep,
  verifyNidStep,
  type CompleteRegistrationInput,
  type FaceVerificationInput,
  type LoginInput,
  type NidVerificationInput,
} from '../services/auth.service.js'

/** Validated payloads are placed on res.locals by the `validate` middleware. */
function body<T>(res: Response): T {
  return (res.locals.validated as { body: T }).body
}

export const getConfig: RequestHandler = (_req, res) => {
  res.json({
    success: true,
    data: {
      facialVerificationMode: env.FACIAL_VERIFICATION_MODE,
      minimumVotingAge: env.MINIMUM_VOTING_AGE,
    },
  })
}

export const postVerifyNid: RequestHandler = async (req, res) => {
  const input = body<NidVerificationInput>(res)
  try {
    const result = await verifyNidStep(input)
    audit({ action: 'auth.verify-nid', outcome: 'success', req })
    res.json({ success: true, data: result })
  } catch (error) {
    // The NID itself is never recorded — only that an attempt failed.
    audit({ action: 'auth.verify-nid', outcome: 'failure', req })
    throw error
  }
}

export const postVerifyFace: RequestHandler = async (_req, res) => {
  const input = body<FaceVerificationInput>(res)
  const result = await verifyFaceStep(input)
  res.json({ success: true, data: result })
}

export const postCompleteRegistration: RequestHandler = async (req, res) => {
  const input = body<CompleteRegistrationInput>(res)
  const session = await completeRegistration(input)
  audit({
    actor: session.user.id,
    actorRole: 'voter',
    action: 'auth.register',
    targetType: 'user',
    targetId: session.user.id,
    outcome: 'success',
    txHash: session.user.registrationTxHash,
    req,
  })
  res.status(201).json({ success: true, data: session })
}

export const postLogin: RequestHandler = async (req, res) => {
  const input = body<LoginInput>(res)
  try {
    const session = await login(input)
    audit({ actor: session.user.id, action: 'auth.login', outcome: 'success', req })
    res.json({ success: true, data: session })
  } catch (error) {
    audit({ action: 'auth.login', outcome: 'failure', req })
    throw error
  }
}

export const getMe: RequestHandler = async (req: Request, res) => {
  res.json({ success: true, data: await toUserDtoWithArea(currentUser(req)) })
}

/**
 * Tokens are stateless, so logging out is a client-side action: the frontend drops the
 * token. This endpoint exists to record the event and to give the client one call to make.
 */
export const postLogout: RequestHandler = (req, res) => {
  const user = req.currentUser
  audit({ actor: user ? String(user._id) : null, action: 'auth.logout', outcome: 'success', req })
  res.json({ success: true, data: null })
}
