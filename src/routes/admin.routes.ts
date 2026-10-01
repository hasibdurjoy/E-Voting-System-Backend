import { Router } from 'express'
import { getStats, getVoters, patchCandidate, postPublishResult, postRevokeVoter } from '../controllers/admin.controller.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
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

export default router
