/**
 * Upazila catalogue.
 *
 * The contract validates area ids but cannot list them — ids are official area codes held
 * in a mapping, and a mapping has no enumeration. Mongo therefore holds the readable
 * catalogue, written when an area is registered and reconciled from `UpazilaRegistered`.
 * The chain stays authoritative for whether an id is valid.
 */
import { getReadOnlyContract } from '../blockchain/index.js'
import { Upazila } from '../models/index.js'
import { ApiError } from '../utils/ApiError.js'
import { relay } from './relayer.service.js'

export interface UpazilaDto {
  upazilaId: number
  name: string
  district: string | null
}

export async function listUpazilas(): Promise<UpazilaDto[]> {
  const rows = await Upazila.find().sort({ upazilaId: 1 })
  return rows.map((row) => ({ upazilaId: row.upazilaId, name: row.name, district: row.district ?? null }))
}

export async function registerUpazila(input: { upazilaId: number; name: string; district?: string }): Promise<UpazilaDto> {
  if (input.upazilaId <= 0) {
    // 0 is reserved on-chain for "every area", so it can never be a real Upazila.
    throw ApiError.unprocessable('An Upazila code must be a positive number.')
  }
  if (await Upazila.exists({ upazilaId: input.upazilaId })) {
    throw ApiError.conflict('That Upazila has already been registered.')
  }

  const receipt = await relay('registerUpazila', 'registerUpazila', [input.upazilaId, input.name])
  const row = await Upazila.create({
    upazilaId: input.upazilaId,
    name: input.name,
    district: input.district ?? null,
    txHash: receipt.txHash,
  })

  return { upazilaId: row.upazilaId, name: row.name, district: row.district ?? null }
}

/**
 * Registers an area if the chain does not already have it, and makes sure the local
 * catalogue row exists either way.
 *
 * The chain outlives the database: dropping Mongo for a fresh demo leaves the Upazilas
 * registered on-chain, and a seed that insisted on registering them again would abort on
 * `UpazilaAlreadyRegistered`. Used by tooling; the admin endpoint stays strict so a typo
 * in a real deployment is still reported as a conflict.
 */
export async function ensureUpazila(input: {
  upazilaId: number
  name: string
  district?: string
}): Promise<{ area: UpazilaDto; created: boolean }> {
  const contract = getReadOnlyContract()
  const onChain = (await contract.isUpazila(input.upazilaId)) as boolean

  if (!onChain) {
    const area = await registerUpazila(input)
    return { area, created: true }
  }

  await Upazila.updateOne(
    { upazilaId: input.upazilaId },
    { $set: { name: input.name, district: input.district ?? null } },
    { upsert: true },
  )
  return {
    area: { upazilaId: input.upazilaId, name: input.name, district: input.district ?? null },
    created: false,
  }
}

/** Throws unless the area exists on-chain. The local catalogue is only a cache. */
export async function assertUpazilaExists(upazilaId: number): Promise<void> {
  if (upazilaId === 0) return // national
  const contract = getReadOnlyContract()
  const known = (await contract.isUpazila(upazilaId)) as boolean
  if (!known) throw ApiError.unprocessable('That Upazila is not registered.')
}

/** Display name for an area id, or null for a national election. */
export async function upazilaName(upazilaId: number): Promise<string | null> {
  if (!upazilaId) return null
  const row = await Upazila.findOne({ upazilaId })
  if (row) return row.name
  try {
    return (await getReadOnlyContract().getUpazilaName(upazilaId)) as string
  } catch {
    return null
  }
}

/** Names for several ids at once, for list endpoints. */
export async function upazilaNames(ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  const rows = await Upazila.find({ upazilaId: { $in: unique } })
  return new Map(rows.map((row) => [row.upazilaId, row.name]))
}
