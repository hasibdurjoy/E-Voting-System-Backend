import dotenv from 'dotenv'
import { isAddress } from 'ethers'
import { z } from 'zod'

dotenv.config({ quiet: true })

/** Treat empty strings from .env files as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required')
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),

  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  BLOCKCHAIN_RPC_URL: optional(z.url('BLOCKCHAIN_RPC_URL must be a valid URL')),
  CONTRACT_ADDRESS: optional(
    z.string().refine((value) => isAddress(value), 'CONTRACT_ADDRESS must be a valid Ethereum address'),
  ),
  BACKEND_PRIVATE_KEY: optional(
    z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'BACKEND_PRIVATE_KEY must be 0x followed by 64 hex characters'),
  ),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    // Only variable names and rule messages are printed — never the values (which may be secrets).
    const details = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${details}`)
  }
  return result.data
}

export const env = loadEnv()

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
