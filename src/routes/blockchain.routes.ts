import { Router } from 'express'
import { getStatus } from '../controllers/blockchain.controller.js'

const router = Router()

/**
 * Connectivity check for the RPC provider, contract and backend wallet. `relayerAuthorized`
 * is the one to look at after deployment: when it is false, every write will revert because
 * the role grant did not happen.
 */
router.get('/status', getStatus)

export default router
