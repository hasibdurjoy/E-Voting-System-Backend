import { Router } from 'express'
import { getTally, getTrusteeElections, postShare } from '../controllers/trustee.controller.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { electionIdParam } from '../validators/election.validator.js'

const router = Router()

router.use(requireAuth, requireRole('trustee'))

router.get('/elections', getTrusteeElections)
router.get('/elections/:id/tally', validate({ params: electionIdParam }), getTally)
router.post('/elections/:id/share', validate({ params: electionIdParam }), postShare)

export default router
