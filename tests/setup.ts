/**
 * Test environment: a real MongoDB and a scripted stand-in for the chain.
 *
 * Mongo is real because the indexes, the unique constraints and the TTL behaviour are part
 * of what is being tested. The chain is scripted because deterministic status codes matter
 * more here than block production — the real chain is exercised by `yarn e2e`.
 */
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'

vi.mock('../src/blockchain/index.js', async () => {
  const { fakeChain, fakeContract } = await import('./helpers/fakeChain.js')
  return {
    getReadOnlyContract: () => fakeContract(),
    getSignerContract: () => fakeContract(),
    getProvider: () => ({
      getBlockNumber: () => Promise.resolve(fakeChain.blockNumber),
      getBalance: () => Promise.resolve(10n ** 18n),
      getBlock: () => Promise.resolve({ timestamp: Math.floor(Date.now() / 1000) }),
    }),
    // The fake chain's clock is the wall clock, so the window rules behave as they do in
    // production, where block.timestamp tracks real time.
    getChainTime: () => Promise.resolve(new Date()),
    resetChainTimeCache: () => undefined,
    getWallet: () => ({ address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' }),
    isContractConfigured: () => true,
    isProviderConfigured: () => true,
    isWalletConfigured: () => true,
    VOTING_REGISTRY_ABI: [],
    VOTING_REGISTRY_ABI_SHA256: 'test',
  }
})

vi.mock('../src/services/relayer.service.js', async () => {
  const { fakeRelay } = await import('./helpers/fakeChain.js')
  const { toApiError } = await import('../src/blockchain/errors.js')
  return {
    // Reverts travel through the same translation layer as in production, so the status
    // codes asserted in the tests are the ones the real mapping produces.
    relay: (context: string, method: string, args: unknown[]) => {
      try {
        return Promise.resolve(fakeRelay(method, args))
      } catch (error) {
        return Promise.reject(toApiError(error, context))
      }
    },
    isRelayerAuthorized: () => Promise.resolve(true),
    isElectionAdminAuthorized: () => Promise.resolve(true),
  }
})

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 5000 })
})

beforeEach(async () => {
  const { fakeChain } = await import('./helpers/fakeChain.js')
  fakeChain.reset()
  const collections = await mongoose.connection.db!.collections()
  await Promise.all(collections.map((collection) => collection.deleteMany({})))
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})
