import { Router } from 'express'
import { getMyReceipts, postVote } from '../controllers/vote.controller.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { voteLimiter } from '../middleware/rateLimiters.js'
import { validate } from '../middleware/validate.js'
import { castVoteSchema } from '../validators/election.validator.js'

const router = Router()

router.post('/', requireAuth, requireRole('voter', 'admin', 'trustee'), voteLimiter, validate({ body: castVoteSchema }), postVote)
router.get('/me', requireAuth, getMyReceipts)

export default router
