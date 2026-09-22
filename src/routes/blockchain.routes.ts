import { Router } from 'express'
import { getStatus } from '../controllers/blockchain.controller.js'
import { notImplemented } from '../controllers/placeholder.controller.js'

const router = Router()

// Connectivity check for the RPC provider, contract and backend wallet.
router.get('/status', getStatus)

// Placeholder — blockchain transaction endpoints will be implemented in a later phase.
router.all('/{*path}', notImplemented('Blockchain'))

export default router
