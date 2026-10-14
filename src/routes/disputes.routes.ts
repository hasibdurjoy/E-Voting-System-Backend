import { Router } from 'express'
import { getMyDisputes, postDispute } from '../controllers/area.controller.js'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { disputeSchema } from '../validators/area.validator.js'

const router = Router()

router.get('/me', requireAuth, getMyDisputes)
router.post('/', requireAuth, validate({ body: disputeSchema }), postDispute)

export default router
