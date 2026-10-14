import { Router } from 'express'
import { getMyTransfers, postTransferRequest } from '../controllers/area.controller.js'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { transferRequestSchema } from '../validators/area.validator.js'

const router = Router()

// A voter may only see and file their own requests; the user comes from the session.
router.get('/me', requireAuth, getMyTransfers)
router.post('/', requireAuth, validate({ body: transferRequestSchema }), postTransferRequest)

export default router
