import { Router } from 'express'
import { notImplemented } from '../controllers/placeholder.controller.js'

// Placeholder — Users endpoints will be implemented in a later phase.
const router = Router()

router.all('/{*path}', notImplemented('Users'))

export default router
