/** Append-only record of who did what. Never holds a raw IP, an NID or a ciphertext. */
import { createHash } from 'node:crypto'
import type { Request } from 'express'
import { AuditLog } from '../models/index.js'
import { logger } from '../utils/logger.js'

export interface AuditInput {
  actor?: string | null
  actorRole?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  outcome: 'success' | 'failure'
  detail?: string | null
  txHash?: string | null
  req?: Request
}

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

/** Fire-and-forget: an audit failure must never break the request it is recording. */
export function audit(input: AuditInput): void {
  const { req, ...rest } = input
  void AuditLog.create({
    ...rest,
    ipHash: hashIp(req?.ip),
    userAgent: req?.get('user-agent') ?? null,
  }).catch((error: unknown) => {
    logger.error('Failed to write audit log entry', error instanceof Error ? error.message : error)
  })
}
