import { Router } from 'express'
import { getMe } from '../controllers/auth.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

/** `/api/users/me` is an alias of `/api/auth/me`; the frontend uses the latter. */
router.get('/me', requireAuth, getMe)

export default router
