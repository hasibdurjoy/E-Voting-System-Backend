/**
 * Seeds the accounts a demonstration needs:
 *
 *   - one admin (Election Commission operator)
 *   - one trustee account per configured TRUSTEE_ADDRESSES entry
 *   - one already-registered voter, so the registration flow can demonstrate its 409 path
 *
 * Safe to re-run: every account is upserted by email. Refuses to run in production, where
 * accounts with known passwords would be an obvious hole.
 *
 *     yarn seed:demo
 */
import { ZeroAddress } from 'ethers'
import { connectDatabase, disconnectDatabase } from '../config/database.js'
import { env, isProduction } from '../config/env.js'
import { generateCommitmentSalt, maskNid, nidLookupHash, voterCommitment } from '../crypto/commitment.js'
import { encryptPii } from '../crypto/pii.js'
import { User } from '../models/index.js'
import { DEMO_UPAZILAS, MOCK_NID_FIXTURES } from '../providers/mock.nid.provider.js'
import { hashPassword } from '../services/auth.service.js'
import { ensureUpazila } from '../services/area.service.js'
import { relay } from '../services/relayer.service.js'
import { logger } from '../utils/logger.js'

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#Passw0rd'

interface SeedAccount {
  nid: string
  email: string
  roles: ('voter' | 'admin' | 'trustee')[]
  walletAddress?: string
  /** Whether to anchor the voter commitment on-chain. */
  registerOnChain: boolean
}

async function seedAccount(account: SeedAccount): Promise<void> {
  const fixture = MOCK_NID_FIXTURES[account.nid]
  if (!fixture) throw new Error(`No mock registry fixture for ${account.nid}`)

  const existing = await User.findOne({ email: account.email })
  if (existing) {
    // Keep roles and address current, but never reset an existing password silently.
    existing.roles = account.roles
    if (account.walletAddress) existing.walletAddress = account.walletAddress.toLowerCase()
    await existing.save()
    logger.info(`Updated ${account.email} (${account.roles.join(', ')})`)
    return
  }

  const salt = generateCommitmentSalt()
  const commitment = voterCommitment(account.nid, salt)

  if (account.registerOnChain) {
    // The area goes on-chain with the registration: it is the eligibility rule.
    await relay('seed:registerVoter', 'registerVoter', [commitment, ZeroAddress, fixture.upazilaId])
  }

  await User.create({
    fullName: fixture.fullName,
    upazilaId: fixture.upazilaId,
    nidEncrypted: encryptPii(account.nid, env.PII_ENCRYPTION_KEY),
    nidLookupHash: nidLookupHash(account.nid, env.NID_HMAC_PEPPER),
    nidMasked: maskNid(account.nid),
    commitmentSalt: encryptPii(salt, env.PII_ENCRYPTION_KEY),
    voterCommitment: commitment,
    dateOfBirth: new Date(`${fixture.dateOfBirth}T00:00:00.000Z`),
    email: account.email,
    phone: '+8801700000000',
    passwordHash: await hashPassword(DEMO_PASSWORD),
    roles: account.roles,
    walletAddress: account.walletAddress?.toLowerCase() ?? null,
    registeredAt: new Date(),
  })

  logger.info(`Created ${account.email} (${account.roles.join(', ')})`)
}

async function main(): Promise<void> {
  if (isProduction) throw new Error('seed:demo refuses to run with NODE_ENV=production')

  await connectDatabase(env.MONGODB_URI)

  // Areas first: a voter cannot be registered into an Upazila that does not exist.
  for (const area of DEMO_UPAZILAS) {
    const { created } = await ensureUpazila({
      upazilaId: area.upazilaId,
      name: area.name,
      district: area.district,
    })
    logger.info(`Upazila ${area.upazilaId} — ${area.name} ${created ? 'registered' : 'already on-chain'}`)
  }

  const trusteeNids = ['1988061122334', '1992033344556', '1985091122445']

  await seedAccount({
    nid: '1995077788899',
    email: 'admin@evoting.test',
    roles: ['admin'],
    registerOnChain: false,
  })

  for (const [index, address] of env.TRUSTEE_ADDRESSES.entries()) {
    const nid = trusteeNids[index]
    if (!nid) {
      logger.warn(`No fixture identity left for trustee ${index + 1}; skipping ${address}`)
      continue
    }
    await seedAccount({
      nid,
      email: `trustee${index + 1}@evoting.test`,
      roles: ['trustee'],
      walletAddress: address,
      registerOnChain: false,
    })
  }

  // The registration page documents this NID as "already registered"; seeding it makes the
  // 409 path demonstrable.
  await seedAccount({
    nid: '1990123456789',
    email: 'ayesha@evoting.test',
    roles: ['voter'],
    registerOnChain: true,
  })

  logger.info(`Demo accounts ready. Password for all seeded accounts: ${DEMO_PASSWORD}`)
  await disconnectDatabase()
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
