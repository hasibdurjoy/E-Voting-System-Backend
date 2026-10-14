import type { RequestHandler, Response } from 'express'
import { currentUser } from '../middleware/auth.js'
import { listUpazilas, registerUpazila } from '../services/area.service.js'
import { audit } from '../services/audit.service.js'
import {
  decideTransfer,
  listMyTransfers,
  listPendingTransfers,
  requestTransfer,
} from '../services/transfer.service.js'
import {
  listMyDisputes,
  listOpenDisputes,
  raiseDispute,
  resolveDispute,
  type DisputeResolution,
} from '../services/dispute.service.js'
import type { DisputeCategory } from '../services/dispute.service.js'

function body<T>(res: Response): T {
  return (res.locals.validated as { body: T }).body
}
function params<T>(res: Response): T {
  return (res.locals.validated as { params: T }).params
}

// ── areas ────────────────────────────────────────────────────────────────────

export const getUpazilas: RequestHandler = async (_req, res) => {
  res.json({ success: true, data: await listUpazilas() })
}

export const postUpazila: RequestHandler = async (req, res) => {
  const admin = currentUser(req)
  const input = body<{ upazilaId: number; name: string; district?: string }>(res)
  const area = await registerUpazila(input)
  audit({
    actor: String(admin._id),
    actorRole: 'admin',
    action: 'area.register',
    targetType: 'upazila',
    targetId: String(area.upazilaId),
    outcome: 'success',
    req,
  })
  res.status(201).json({ success: true, data: area })
}

// ── transfers ────────────────────────────────────────────────────────────────

export const postTransferRequest: RequestHandler = async (req, res) => {
  const user = currentUser(req)
  const input = body<{ toUpazilaId: number; evidence: string }>(res)
  const request = await requestTransfer(user, input)
  audit({
    actor: String(user._id),
    actorRole: 'voter',
    action: 'transfer.request',
    targetType: 'transfer',
    targetId: request.id,
    outcome: 'success',
    req,
  })
  res.status(201).json({ success: true, data: request })
}

export const getMyTransfers: RequestHandler = async (req, res) => {
  res.json({ success: true, data: await listMyTransfers(currentUser(req)) })
}

export const getPendingTransfers: RequestHandler = async (_req, res) => {
  res.json({ success: true, data: await listPendingTransfers() })
}

export const postTransferDecision: RequestHandler = async (req, res) => {
  const admin = currentUser(req)
  const { id } = params<{ id: string }>(res)
  const decision = body<{ approve: boolean; reason?: string }>(res)
  const request = await decideTransfer(id, decision, String(admin._id))
  audit({
    actor: String(admin._id),
    actorRole: 'admin',
    action: decision.approve ? 'transfer.approve' : 'transfer.reject',
    targetType: 'transfer',
    targetId: id,
    outcome: 'success',
    txHash: request.txHash,
    req,
  })
  res.json({ success: true, data: request })
}

// ── disputes ─────────────────────────────────────────────────────────────────

export const postDispute: RequestHandler = async (req, res) => {
  const user = currentUser(req)
  const input = body<{ category: DisputeCategory; detail: string; subjectUserId?: string }>(res)
  const isAdmin = (user.roles ?? []).includes('admin')
  const dispute = await raiseDispute(user, input, isAdmin ? 'admin' : 'voter')
  audit({
    actor: String(user._id),
    actorRole: isAdmin ? 'admin' : 'voter',
    action: 'dispute.raise',
    targetType: 'dispute',
    targetId: dispute.id,
    outcome: 'success',
    txHash: dispute.holdTxHash,
    req,
  })
  res.status(201).json({ success: true, data: dispute })
}

export const getMyDisputes: RequestHandler = async (req, res) => {
  res.json({ success: true, data: await listMyDisputes(currentUser(req)) })
}

export const getOpenDisputes: RequestHandler = async (_req, res) => {
  res.json({ success: true, data: await listOpenDisputes() })
}

export const postDisputeResolution: RequestHandler = async (req, res) => {
  const admin = currentUser(req)
  const { id } = params<{ id: string }>(res)
  const decision = body<DisputeResolution>(res)
  const dispute = await resolveDispute(id, decision, String(admin._id))
  audit({
    actor: String(admin._id),
    actorRole: 'admin',
    action: 'dispute.resolve',
    targetType: 'dispute',
    targetId: id,
    outcome: 'success',
    detail: decision.outcome,
    txHash: dispute.releaseTxHash,
    req,
  })
  res.json({ success: true, data: dispute })
}
