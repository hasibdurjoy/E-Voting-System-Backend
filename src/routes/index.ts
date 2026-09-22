import { Router } from 'express'
import adminRoutes from './admin.routes.js'
import authRoutes from './auth.routes.js'
import blockchainRoutes from './blockchain.routes.js'
import candidateRoutes from './candidates.routes.js'
import electionRoutes from './elections.routes.js'
import healthRoutes from './health.routes.js'
import userRoutes from './users.routes.js'
import voteRoutes from './votes.routes.js'

const router = Router()

router.use('/health', healthRoutes)
router.use('/auth', authRoutes)
router.use('/users', userRoutes)
router.use('/elections', electionRoutes)
router.use('/candidates', candidateRoutes)
router.use('/votes', voteRoutes)
router.use('/admin', adminRoutes)
router.use('/blockchain', blockchainRoutes)

export default router
