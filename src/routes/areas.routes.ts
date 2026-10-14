import { Router } from 'express'
import { getUpazilas } from '../controllers/area.controller.js'

const router = Router()

/** The Upazila catalogue is public: a voter needs it to read an election's area. */
router.get('/', getUpazilas)

export default router
