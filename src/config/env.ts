import dotenv from 'dotenv'
import { isAddress } from 'ethers'
import { z } from 'zod'

dotenv.config({ quiet: true })

/** Treat empty strings from .env files as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const hex32 = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'must be 32 bytes of hex (64 characters)')

const envSchema = z
  .object({
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
    /** Below this balance the relayer is one election away from halting; warn loudly. */
    RELAYER_MIN_BALANCE_ETH: z.coerce.number().nonnegative().default(0.05),
    /** Confirmations before a receipt is treated as final. 1 is fine locally, not on a public chain. */
    CONFIRMATIONS: z.coerce.number().int().positive().default(1),
    /** The contract's deployment block. Nothing before it can hold an event, so scans start here. */
    BLOCKCHAIN_START_BLOCK: z.coerce.number().int().nonnegative().default(0),
    /** Widest eth_getLogs range the RPC accepts. Alchemy's free tier allows 10; a local node, anything. */
    LOG_BLOCK_RANGE: z.coerce.number().int().positive().default(2000),

    /**
     * Global API rate limit. The default is deliberately strict; raise it for a load test
     * or a scripted demo rather than removing the limiter.
     */
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    /**
     * Credential-guessing limit, keyed by IP *and* the identifier being tried. Deliberately
     * small; raising it weakens the protection against an enumeration attack.
     */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    /**
     * Registrations per IP. Several voters legitimately share one address — a household, a
     * community centre, an assisted-registration desk — so this is looser than the auth
     * limit, and configurable for deployments where that is common.
     */
    REGISTRATION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    /**
     * Ballots per IP. One voter can only ever cast one ballot per election — the contract
     * sees to that — so this exists to stop scripted abuse, not double voting, and must
     * leave room for a shared address or an assisted-voting desk.
     */
    VOTE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

    // ── auth ──────────────────────────────────────────────────────────────
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').default('dev-only-insecure-jwt-secret-change-me'),
    JWT_EXPIRES_IN: z.string().default('24h'),
    FACIAL_VERIFICATION_MODE: z.enum(['registration_only', 'login_and_registration']).default('registration_only'),
    MINIMUM_VOTING_AGE: z.coerce.number().int().positive().default(18),

    // ── identity providers ────────────────────────────────────────────────
    NID_PROVIDER: z.string().default('mock'),
    NID_PROVIDER_URL: optional(z.url()),
    NID_PROVIDER_KEY: optional(z.string()),
    FACE_PROVIDER: z.string().default('mock'),
    FACE_PROVIDER_URL: optional(z.url()),
    FACE_PROVIDER_KEY: optional(z.string()),
    FACE_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
    FACE_LIVENESS_REQUIRED: z
      .string()
      .default('true')
      .transform((value) => value !== 'false'),

    // ── identity cryptography ─────────────────────────────────────────────
    NID_HMAC_PEPPER: z.string().default('dev-only-insecure-nid-pepper-change-me'),
    PII_ENCRYPTION_KEY: hex32.default('00'.repeat(32)),

    // ── election cryptography ─────────────────────────────────────────────
    /**
     * The trustee committee, as signing addresses. Each holds TRUSTEE_ROLE and submits its
     * own decryption share — the backend never signs on their behalf.
     */
    TRUSTEE_ADDRESSES: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((address) => address.trim())
          .filter(Boolean),
      )
      .refine(
        (addresses) => addresses.every((address) => isAddress(address)),
        'TRUSTEE_ADDRESSES must be a comma-separated list of Ethereum addresses',
      ),

    PAILLIER_KEY_BITS: z.coerce
      .number()
      .int()
      .refine((value) => value % 256 === 0, 'PAILLIER_KEY_BITS must be a multiple of 256 (the contract requires len(n) % 32 == 0 bytes)')
      .default(2048),
    BALLOT_BASE_BITS: z.coerce.number().int().positive().max(64).default(32),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') return

    // Development defaults are deliberately permissive so the project runs out of the box;
    // in production every one of them is a vulnerability, so they are refused here.
    const require = (field: keyof typeof value, message: string) =>
      ctx.addIssue({ code: 'custom', path: [field], message })

    if (value.JWT_SECRET === 'dev-only-insecure-jwt-secret-change-me') {
      require('JWT_SECRET', 'must be set to a real secret in production')
    }
    if (value.NID_HMAC_PEPPER === 'dev-only-insecure-nid-pepper-change-me') {
      require('NID_HMAC_PEPPER', 'must be set in production — it is what keeps NIDs un-brute-forceable')
    }
    if (value.PII_ENCRYPTION_KEY === '00'.repeat(32)) {
      require('PII_ENCRYPTION_KEY', 'must be set to a real 32-byte key in production')
    }
    if (value.NID_PROVIDER === 'mock') {
      require('NID_PROVIDER', 'the mock identity registry must never be used in production')
    }
    if (value.FACE_PROVIDER === 'mock') {
      require('FACE_PROVIDER', 'the mock face provider must never be used in production')
    }
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

/** Base used to pack per-candidate counters into one Paillier plaintext. */
export const BALLOT_BASE = 2n ** BigInt(env.BALLOT_BASE_BITS)
