import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Mongo state is shared, so files run one at a time rather than racing each other.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://localhost:27017/e_voting_system_test',
      CORS_ORIGIN: 'http://localhost:5173',
      JWT_SECRET: 'test-only-secret-at-least-32-characters-long',
      NID_HMAC_PEPPER: 'test-only-pepper',
      PII_ENCRYPTION_KEY: '11'.repeat(32),
      // 512-bit keys keep election creation fast; the width rules are identical.
      PAILLIER_KEY_BITS: '512',
      BALLOT_BASE_BITS: '32',
      TRUSTEE_ADDRESSES:
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8,0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      CONTRACT_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      BLOCKCHAIN_RPC_URL: 'http://127.0.0.1:8545',
    },
  },
})
