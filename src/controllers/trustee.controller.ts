import type { RequestHandler, Response } from 'express'
import { currentUser } from '../middleware/auth.js'
import { audit } from '../services/audit.service.js'
import { getEncryptedTally, listTrusteeElections, recordShareSubmission } from '../services/trustee.service.js'

function params<T>(res: Response): T {
  return (res.locals.validated as { params: T }).params
}

export const getTrusteeElections: RequestHandler = async (req, res) => {
  res.json({ success: true, data: await listTrusteeElections(currentUser(req)) })
}

export const getTally: RequestHandler = async (req, res) => {
  const { id } = params<{ id: number }>(res)
  res.json({ success: true, data: await getEncryptedTally(currentUser(req), id) })
}

export const postShare: RequestHandler = async (req, res) => {
  const user = currentUser(req)
  const { id } = params<{ id: number }>(res)
  const submission = await recordShareSubmission(user, id)
  audit({
    actor: String(user._id),
    actorRole: 'trustee',
    action: 'trustee.share-recorded',
    targetType: 'election',
    targetId: String(id),
    outcome: 'success',
    txHash: submission.txHash || null,
    req,
  })
  res.json({ success: true, data: submission })
}
