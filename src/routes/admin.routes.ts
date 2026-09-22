import { Router } from 'express'
import { notImplemented } from '../controllers/placeholder.controller.js'

// Placeholder — Admin endpoints will be implemented in a later phase.
const router = Router()

router.all('/{*path}', notImplemented('Admin'))

export default router
