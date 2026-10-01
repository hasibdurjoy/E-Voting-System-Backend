import { Router } from 'express'
import { getMyCandidacies } from '../controllers/election.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// A voter may read their own candidacies and nobody else's — the user is taken from the
// session, never from a query parameter.
router.get('/me', requireAuth, getMyCandidacies)

export default router
