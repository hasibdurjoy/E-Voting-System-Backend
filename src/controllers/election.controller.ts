import type { RequestHandler, Response } from 'express'
import { currentUser } from '../middleware/auth.js'
import { audit } from '../services/audit.service.js'
import {
  applyAsCandidate,
  listMyCandidacies,
  type CandidateApplicationInput,
} from '../services/candidate.service.js'
import {
  createElection,
  getElectionDetail,
  listElections,
  transitionElection,
  type CreateElectionInput,
  type ElectionTransition,
} from '../services/election.service.js'
import { getResults } from '../services/result.service.js'
import { checkEligibility } from '../services/vote.service.js'

function body<T>(res: Response): T {
  return (res.locals.validated as { body: T }).body
}
function params<T>(res: Response): T {
  return (res.locals.validated as { params: T }).params
}

export const getElections: RequestHandler = async (_req, res) => {
  res.json({ success: true, data: await listElections() })
}

export const getElection: RequestHandler = async (_req, res) => {
  const { id } = params<{ id: number }>(res)
  res.json({ success: true, data: await getElectionDetail(id) })
}

export const getEligibility: RequestHandler = async (req, res) => {
  const { id } = params<{ id: number }>(res)
  res.json({ success: true, data: await checkEligibility(req.currentUser, id) })
}

export const getElectionResults: RequestHandler = async (_req, res) => {
  const { id } = params<{ id: number }>(res)
  res.json({ success: true, data: await getResults(id) })
}

export const postElection: RequestHandler = async (req, res) => {
  const user = currentUser(req)
  const input = body<CreateElectionInput>(res)
  const election = await createElection(input, String(user._id))
  audit({
    actor: String(user._id),
    actorRole: 'admin',
    action: 'election.create',
    targetType: 'election',
    targetId: String(election.id),
    outcome: 'success',
    req,
  })
  res.status(201).json({ success: true, data: election })
}

export const postTransition: RequestHandler = async (req, res) => {
  const user = currentUser(req)
  const { id } = params<{ id: number }>(res)
  const { transition } = body<{ transition: ElectionTransition }>(res)
  const election = await transitionElection(id, transition)
  audit({
    actor: String(user._id),
    actorRole: 'admin',
    action: `election.${transition}`,
    targetType: 'election',
    targetId: String(id),
    outcome: 'success',
    req,
  })
  res.json({ success: true, data: election })
}

export const postCandidateApplication: RequestHandler = async (req, res) => {
  const user = currentUser(req)
  const { id } = params<{ id: number }>(res)
  const input = body<CandidateApplicationInput>(res)
  // The path is authoritative: a body claiming a different election is not honoured.
  const candidate = await applyAsCandidate(user, { ...input, electionId: id })
  audit({
    actor: String(user._id),
    actorRole: 'voter',
    action: 'candidate.apply',
    targetType: 'candidate',
    targetId: `${id}:${candidate.id}`,
    outcome: 'success',
    req,
  })
  res.status(201).json({ success: true, data: candidate })
}

export const getMyCandidacies: RequestHandler = async (req, res) => {
  res.json({ success: true, data: await listMyCandidacies(currentUser(req)) })
}
