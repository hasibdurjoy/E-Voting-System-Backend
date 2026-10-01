import { Router } from 'express'
import {
  getElection,
  getElections,
  getElectionResults,
  getEligibility,
  postCandidateApplication,
  postElection,
  postTransition,
} from '../controllers/election.controller.js'
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import {
  candidateApplicationSchema,
  createElectionSchema,
  electionIdParam,
  transitionSchema,
} from '../validators/election.validator.js'

const router = Router()

router.get('/', getElections)
router.post('/', requireAuth, requireRole('admin'), validate({ body: createElectionSchema }), postElection)

router.get('/:id', validate({ params: electionIdParam }), getElection)

// Eligibility is readable without a session: the answer is then "not-authenticated",
// which is what the ballot page shows a signed-out visitor.
router.get('/:id/eligibility', optionalAuth, validate({ params: electionIdParam }), getEligibility)
router.get('/:id/results', validate({ params: electionIdParam }), getElectionResults)

router.post(
  '/:id/transition',
  requireAuth,
  requireRole('admin'),
  validate({ params: electionIdParam, body: transitionSchema }),
  postTransition,
)

router.post(
  '/:id/candidates',
  requireAuth,
  requireRole('voter', 'admin', 'trustee'),
  validate({ params: electionIdParam, body: candidateApplicationSchema }),
  postCandidateApplication,
)

export default router
