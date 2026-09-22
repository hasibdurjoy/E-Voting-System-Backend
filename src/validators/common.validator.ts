import { isAddress } from 'ethers'
import { isValidObjectId } from 'mongoose'
import { z } from 'zod'

/** Reusable Zod schemas for future request validation. */
export const objectIdSchema = z.string().refine((value) => isValidObjectId(value), 'Invalid ObjectId')

export const ethereumAddressSchema = z.string().refine((value) => isAddress(value), 'Invalid Ethereum address')

export const idParamSchema = z.object({ id: objectIdSchema })
