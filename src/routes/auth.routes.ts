import express, { Router } from 'express'
import {
  getConfig,
  getMe,
  postCompleteRegistration,
  postLogin,
  postLogout,
  postVerifyFace,
  postVerifyNid,
} from '../controllers/auth.controller.js'
import { requireAuth } from '../middleware/auth.js'
import { loginLimiter, nidVerificationLimiter, registrationLimiter } from '../middleware/rateLimiters.js'
import { validate } from '../middleware/validate.js'
import {
  completeRegistrationSchema,
  loginSchema,
  verifyFaceSchema,
  verifyNidSchema,
} from '../validators/auth.validator.js'

/**
 * A selfie data URL is far larger than the 100 kB global JSON cap, so the two routes that
 * carry one parse with their own limit. Raising the global cap instead would hand every
 * other endpoint an 8 MB attack surface for nothing.
 */
const selfieJson = express.json({ limit: '8mb' })

const router = Router()

router.get('/config', getConfig)

router.post('/register/verify-nid', nidVerificationLimiter, validate({ body: verifyNidSchema }), postVerifyNid)
router.post('/register/verify-face', registrationLimiter, selfieJson, validate({ body: verifyFaceSchema }), postVerifyFace)
router.post('/register/complete', registrationLimiter, validate({ body: completeRegistrationSchema }), postCompleteRegistration)

router.post('/login', loginLimiter, selfieJson, validate({ body: loginSchema }), postLogin)
router.get('/me', requireAuth, getMe)
router.post('/logout', requireAuth, postLogout)

export default router
