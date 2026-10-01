import type { RequestHandler, Response } from 'express'
import { currentUser } from '../middleware/auth.js'
import { audit } from '../services/audit.service.js'
import { castVote, listMyReceipts, type CastVoteInput } from '../services/vote.service.js'

function body<T>(res: Response): T {
  return (res.locals.validated as { body: T }).body
}

export const postVote: RequestHandler = async (req, res) => {
  const user = currentUser(req)
  const input = body<CastVoteInput>(res)
  const receipt = await castVote(user, input)

  // The audit trail records THAT a ballot was cast, never the ciphertext: the two together
  // would be the voter→ballot link the whole design exists to prevent.
  audit({
    actor: String(user._id),
    actorRole: 'voter',
    action: 'vote.cast',
    targetType: 'election',
    targetId: String(input.electionId),
    outcome: 'success',
    txHash: receipt.txHash,
    req,
  })

  res.status(201).json({ success: true, data: receipt })
}

export const getMyReceipts: RequestHandler = async (req, res) => {
  res.json({ success: true, data: await listMyReceipts(currentUser(req)) })
}
