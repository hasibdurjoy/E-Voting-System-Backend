import { Router } from 'express'
import { notImplemented } from '../controllers/placeholder.controller.js'

// Placeholder — Elections endpoints will be implemented in a later phase.
const router = Router()

router.all('/{*path}', notImplemented('Elections'))

export default router
