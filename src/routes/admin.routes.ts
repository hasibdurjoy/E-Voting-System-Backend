import { Router } from 'express'
import { getStats, getVoters, patchCandidate, postPublishResult, postRevokeVoter } from '../controllers/admin.controller.js'
import {
  getOpenDisputes,
  getPendingTransfers,
  postDisputeResolution,
  postTransferDecision,
  postUpazila,
} from '../controllers/area.controller.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import {
  disputeResolutionSchema,
  objectIdParam,
  registerUpazilaSchema,
  transferDecisionSchema,
} from '../validators/area.validator.js'
import { candidateDecisionSchema, candidateIdParam, electionIdParam, voterIdParam } from '../validators/election.validator.js'

const router = Router()

// Every route here is admin-only; the guard is applied once rather than per-route so a new
// route cannot accidentally be added without it.
router.use(requireAuth, requireRole('admin'))

router.get('/stats', getStats)
router.get('/voters', getVoters)
router.post('/voters/:id/revoke', validate({ params: voterIdParam }), postRevokeVoter)
router.patch('/candidates/:id', validate({ params: candidateIdParam, body: candidateDecisionSchema }), patchCandidate)
router.post('/elections/:id/publish-result', validate({ params: electionIdParam }), postPublishResult)

// ── area administration: the validator's side of the workflow ────────────────
router.post('/upazilas', validate({ body: registerUpazilaSchema }), postUpazila)

router.get('/transfers', getPendingTransfers)
router.post(
  '/transfers/:id/decide',
  validate({ params: objectIdParam, body: transferDecisionSchema }),
  postTransferDecision,
)

router.get('/disputes', getOpenDisputes)
router.post(
  '/disputes/:id/resolve',
  validate({ params: objectIdParam, body: disputeResolutionSchema }),
  postDisputeResolution,
)

export default router
