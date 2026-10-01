import type { RequestHandler, Response } from 'express'
import { currentUser } from '../middleware/auth.js'
import { getAdminStats, listVoters, revokeVoter } from '../services/admin.service.js'
import { audit } from '../services/audit.service.js'
import { decideCandidate } from '../services/candidate.service.js'
import { publishResult } from '../services/result.service.js'
import type { CandidateStatus } from '../types/domain.js'

function body<T>(res: Response): T {
  return (res.locals.validated as { body: T }).body
}
function params<T>(res: Response): T {
  return (res.locals.validated as { params: T }).params
}

export const getStats: RequestHandler = async (_req, res) => {
  res.json({ success: true, data: await getAdminStats() })
}

export const getVoters: RequestHandler = async (_req, res) => {
  res.json({ success: true, data: await listVoters() })
}

export const postRevokeVoter: RequestHandler = async (req, res) => {
  const admin = currentUser(req)
  const { id } = params<{ id: string }>(res)
  const voter = await revokeVoter(id)
  audit({
    actor: String(admin._id),
    actorRole: 'admin',
    action: 'voter.revoke',
    targetType: 'user',
    targetId: id,
    outcome: 'success',
    req,
  })
  res.json({ success: true, data: voter })
}

export const patchCandidate: RequestHandler = async (req, res) => {
  const admin = currentUser(req)
  const { id } = params<{ id: number }>(res)
  const input = body<{ electionId: number; status: CandidateStatus; reason?: string }>(res)
  const candidate = await decideCandidate(
    input.electionId,
    id,
    input.status as 2 | 3,
    input.reason,
  )
  audit({
    actor: String(admin._id),
    actorRole: 'admin',
    action: 'candidate.decide',
    targetType: 'candidate',
    targetId: `${input.electionId}:${id}`,
    outcome: 'success',
    detail: `status=${input.status}`,
    req,
  })
  res.json({ success: true, data: candidate })
}

export const postPublishResult: RequestHandler = async (req, res) => {
  const admin = currentUser(req)
  const { id } = params<{ id: number }>(res)
  const result = await publishResult(id)
  audit({
    actor: String(admin._id),
    actorRole: 'admin',
    action: 'election.publish-result',
    targetType: 'election',
    targetId: String(id),
    outcome: 'success',
    txHash: result.publishTxHash,
    req,
  })
  res.json({ success: true, data: result })
}
