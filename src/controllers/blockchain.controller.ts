import type { RequestHandler } from 'express'
import { getBlockchainStatus } from '../services/blockchain.service.js'

export const getStatus: RequestHandler = async (_req, res) => {
  const status = await getBlockchainStatus()
  res.json({ success: true, data: status })
}
