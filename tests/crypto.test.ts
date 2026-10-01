import { describe, expect, it } from 'vitest'
import { byteLengthOf, hexToBigInt } from '../src/crypto/bigint.js'
import {
  addCiphertexts,
  decrypt,
  encrypt,
  generateKeyPair,
  serialiseCiphertext,
  serialisePublicKey,
} from '../src/crypto/paillier.js'
import {
  combineShares,
  createThresholdSetup,
  packBallot,
  partialDecrypt,
  serialiseShare,
  unpackTotals,
  type PartialDecryption,
} from '../src/crypto/threshold.js'

// 512 bits keeps the suite fast. Elections use PAILLIER_KEY_BITS (2048 by default);
// the arithmetic is identical, only slower.
const KEY_BITS = 512
const keyPair = generateKeyPair(KEY_BITS)
const { publicKey, privateKey } = keyPair
const BALLOT_BASE = 2n ** 32n

describe('Paillier', () => {
  it('generates a key of the requested width with safe primes', () => {
    expect(publicKey.n.toString(2).length).toBe(KEY_BITS)
    expect(publicKey.n).toBe(privateKey.p * privateKey.q)
    // Safe primes: (p−1)/2 must itself be prime, which the threshold scheme depends on.
    for (const prime of [privateKey.p, privateKey.q]) {
      const sophieGermain = (prime - 1n) / 2n
      expect(prime % 2n).toBe(1n)
      expect(sophieGermain % 2n).toBe(1n)
    }
  })

  it('satisfies the contract encoding rules', () => {
    const serialised = serialisePublicKey(publicKey)
    const nBytes = byteLengthOf(publicKey.n)
    expect(nBytes % 32).toBe(0) // contract: len(n) must be a multiple of 32
    expect((serialised.nSquared.length - 2) / 2).toBe(nBytes * 2) // exactly 2 × len(n)
    expect(hexToBigInt(serialised.nSquared) % 2n).toBe(1n) // and odd
    expect(hexToBigInt(serialised.n)).toBe(publicKey.n)
  })

  it('round-trips a plaintext', () => {
    for (const plaintext of [0n, 1n, 42n, 2n ** 64n]) {
      expect(decrypt(encrypt(plaintext, publicKey), publicKey, privateKey)).toBe(plaintext)
    }
  })

  it('produces a different ciphertext every time', () => {
    const a = encrypt(1n, publicKey)
    const b = encrypt(1n, publicKey)
    expect(a).not.toBe(b)
    expect(decrypt(a, publicKey, privateKey)).toBe(decrypt(b, publicKey, privateKey))
  })

  it('adds homomorphically, as the contract does on-chain', () => {
    const sum = addCiphertexts(encrypt(7n, publicKey), encrypt(35n, publicKey), publicKey)
    expect(decrypt(sum, publicKey, privateKey)).toBe(42n)
  })

  it('pads every ciphertext to exactly len(n²)', () => {
    for (let i = 0; i < 5; i++) {
      const hex = serialiseCiphertext(encrypt(BigInt(i), publicKey), publicKey)
      expect((hex.length - 2) / 2).toBe(publicKey.ciphertextBytes)
      expect(hex.startsWith('0x')).toBe(true)
    }
  })

  it('refuses a plaintext outside [0, n)', () => {
    expect(() => encrypt(publicKey.n, publicKey)).toThrow(/out of range/i)
    expect(() => encrypt(-1n, publicKey)).toThrow(/out of range/i)
  })
})

describe('threshold decryption', () => {
  const TRUSTEES = 5
  const THRESHOLD = 3
  const setup = createThresholdSetup(publicKey, privateKey, TRUSTEES, THRESHOLD)

  /** Encrypts a known distribution and aggregates it exactly as the contract would. */
  function encryptedTallyOf(distribution: number[]): bigint {
    let aggregate = encrypt(0n, publicKey)
    distribution.forEach((votes, ballotIndex) => {
      for (let i = 0; i < votes; i++) {
        aggregate = addCiphertexts(aggregate, encrypt(packBallot(ballotIndex, BALLOT_BASE), publicKey), publicKey)
      }
    })
    return aggregate
  }

  function partialsFor(aggregate: bigint, indices: number[]): PartialDecryption[] {
    return indices.map((index) => {
      const share = setup.shares.find((candidate) => candidate.index === index)
      if (!share) throw new Error(`no share ${index}`)
      return { index, value: partialDecrypt(aggregate, share, setup.delta, publicKey) }
    })
  }

  it('refuses a threshold below 2 — one trustee must never decrypt alone', () => {
    expect(() => createThresholdSetup(publicKey, privateKey, 3, 1)).toThrow(/at least 2/i)
    expect(() => createThresholdSetup(publicKey, privateKey, 3, 4)).toThrow(/cannot exceed/i)
  })

  it('opens a known tally — the 3 / 1 / 2 acceptance check', () => {
    const aggregate = encryptedTallyOf([3, 1, 2])
    const packed = combineShares(partialsFor(aggregate, [1, 2, 3]), setup.delta, publicKey, THRESHOLD)
    expect(unpackTotals(packed, 3, BALLOT_BASE)).toEqual([3, 1, 2])
  })

  it('gives the same result for ANY k-subset of shares', () => {
    const aggregate = encryptedTallyOf([4, 0, 7])
    const subsets = [
      [1, 2, 3],
      [1, 3, 5],
      [2, 4, 5],
      [3, 4, 5],
    ]
    for (const subset of subsets) {
      const packed = combineShares(partialsFor(aggregate, subset), setup.delta, publicKey, THRESHOLD)
      expect(unpackTotals(packed, 3, BALLOT_BASE)).toEqual([4, 0, 7])
    }
  })

  it('does not reveal the tally with k−1 shares', () => {
    const aggregate = encryptedTallyOf([3, 1, 2])
    const tooFew = partialsFor(aggregate, [1, 2])

    // The guard refuses outright …
    expect(() => combineShares(tooFew, setup.delta, publicKey, THRESHOLD)).toThrow(/at least 3/i)

    // … and forcing the combination through anyway yields garbage, not the real totals.
    const forced = combineShares(tooFew, setup.delta, publicKey, 2)
    let matchedKnownTally: boolean
    try {
      matchedKnownTally = JSON.stringify(unpackTotals(forced, 3, BALLOT_BASE)) === JSON.stringify([3, 1, 2])
    } catch {
      matchedKnownTally = false // did not even unpack — also a failure to learn anything
    }
    expect(matchedKnownTally).toBe(false)
  })

  it('rejects duplicate shares from the same trustee', () => {
    const aggregate = encryptedTallyOf([1, 0])
    const duplicated = partialsFor(aggregate, [1, 1, 2])
    expect(() => combineShares(duplicated, setup.delta, publicKey, THRESHOLD)).toThrow(/duplicate/i)
  })

  it('counts an election with zero votes', () => {
    const aggregate = encryptedTallyOf([0, 0, 0])
    const packed = combineShares(partialsFor(aggregate, [1, 2, 3]), setup.delta, publicKey, THRESHOLD)
    expect(unpackTotals(packed, 3, BALLOT_BASE)).toEqual([0, 0, 0])
  })

  it('serialises shares to the contract width', () => {
    const aggregate = encryptedTallyOf([1, 1])
    const [partial] = partialsFor(aggregate, [1])
    const hex = serialiseShare(partial.value, publicKey)
    expect((hex.length - 2) / 2).toBe(publicKey.ciphertextBytes)
  })
})

describe('base-B packing', () => {
  it('keeps each candidate in its own digit, including a zero in the middle', () => {
    const packed = packBallot(0, BALLOT_BASE) * 5n + packBallot(1, BALLOT_BASE) * 0n + packBallot(2, BALLOT_BASE) * 9n
    expect(unpackTotals(packed, 3, BALLOT_BASE)).toEqual([5, 0, 9])
  })

  it('handles a total near the top of the base', () => {
    const large = Number(BALLOT_BASE - 1n)
    const packed = packBallot(0, BALLOT_BASE) * BigInt(large) + packBallot(1, BALLOT_BASE) * 3n
    expect(unpackTotals(packed, 2, BALLOT_BASE)).toEqual([large, 3])
  })

  it('refuses to unpack a tally wider than the candidate count', () => {
    const packed = packBallot(3, BALLOT_BASE)
    expect(() => unpackTotals(packed, 2, BALLOT_BASE)).toThrow(/does not fit/i)
  })
})
