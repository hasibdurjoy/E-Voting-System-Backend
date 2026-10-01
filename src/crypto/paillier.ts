/**
 * Paillier key generation and (for tests and tooling) single-key decryption.
 *
 * The scheme must match the frontend's `src/lib/paillier.ts` byte-for-byte on the wire:
 *
 *     g = n + 1,  E(m, r) = (1 + m·n) · rⁿ mod n²
 *
 * Production elections never use `decrypt()` — the private key is split across trustees
 * and the tally is opened with `threshold.ts`. It exists so the crypto can be tested
 * against a known plaintext, which is the only way to catch a silent threshold bug.
 */
import { generatePrimeSync } from 'node:crypto'
import { bigIntToHex, byteLengthOf, gcd, hexToBigInt, modInverse, modPow, randomBelow } from './bigint.js'

export interface PaillierPublicKey {
  n: bigint
  nSquared: bigint
  /** Byte width of n² — the exact ciphertext width the contract enforces. */
  ciphertextBytes: number
}

export interface PaillierPrivateKey {
  /** Safe-prime factors. Needed by the threshold setup: m = p'q' = ((p-1)/2)((q-1)/2). */
  p: bigint
  q: bigint
  lambda: bigint
  mu: bigint
}

export interface PaillierKeyPair {
  publicKey: PaillierPublicKey
  privateKey: PaillierPrivateKey
}

export function publicKeyFromN(n: bigint): PaillierPublicKey {
  const nSquared = n * n
  return { n, nSquared, ciphertextBytes: byteLengthOf(nSquared) }
}

/**
 * Generates a key with **safe primes** (p = 2p'+1), which the threshold scheme requires:
 * it needs m = p'q' to be the order of the subgroup it shares the private exponent over.
 *
 * Uses Node's native prime generation — a pure-JS safe-prime search at 1024 bits takes
 * minutes, which would make every test run unusable.
 */
export function generateKeyPair(bits: number): PaillierKeyPair {
  if (bits % 64 !== 0) throw new Error('Key size must be a multiple of 64 bits')
  const half = bits / 2

  let p: bigint
  let q: bigint
  let n: bigint
  do {
    p = generatePrimeSync(half, { safe: true, bigint: true })
    do {
      q = generatePrimeSync(half, { safe: true, bigint: true })
    } while (p === q)
    n = p * q
    // Both factors are the same width, so n is always `bits` wide; the guard catches the
    // rare carry-free case where the top bit lands short.
  } while (n.toString(2).length !== bits || gcd(n, (p - 1n) * (q - 1n)) !== 1n)

  const lambda = ((p - 1n) * (q - 1n)) / gcd(p - 1n, q - 1n)
  // With g = n + 1, L(gᵏ mod n²) = k, so mu is simply lambda⁻¹ mod n.
  const mu = modInverse(lambda, n)

  return { publicKey: publicKeyFromN(n), privateKey: { p, q, lambda, mu } }
}

/** L(x) = (x − 1) / n */
export function L(x: bigint, n: bigint): bigint {
  return (x - 1n) / n
}

/** Encrypts `plaintext`. Identical to the frontend implementation — used by tests. */
export function encrypt(plaintext: bigint, publicKey: PaillierPublicKey): bigint {
  const { n, nSquared } = publicKey
  if (plaintext < 0n || plaintext >= n) throw new Error('Plaintext out of range')

  let r = randomBelow(n)
  while (gcd(r, n) !== 1n) r = randomBelow(n)

  const gm = (1n + plaintext * n) % nSquared
  return (gm * modPow(r, n, nSquared)) % nSquared
}

/** Single-key decryption. Tests and tooling only — never used to open a real election. */
export function decrypt(ciphertext: bigint, publicKey: PaillierPublicKey, privateKey: PaillierPrivateKey): bigint {
  const { n, nSquared } = publicKey
  return (L(modPow(ciphertext, privateKey.lambda, nSquared), n) * privateKey.mu) % n
}

/** The homomorphic addition the contract performs on-chain: E(a)·E(b) = E(a+b). */
export function addCiphertexts(a: bigint, b: bigint, publicKey: PaillierPublicKey): bigint {
  return (a * b) % publicKey.nSquared
}

/** Serialises a ciphertext to the exact width the contract requires. */
export function serialiseCiphertext(value: bigint, publicKey: PaillierPublicKey): string {
  return bigIntToHex(value, publicKey.ciphertextBytes)
}

export function serialisePublicKey(publicKey: PaillierPublicKey): { n: string; nSquared: string } {
  const nBytes = byteLengthOf(publicKey.n)
  return {
    n: bigIntToHex(publicKey.n, nBytes),
    nSquared: bigIntToHex(publicKey.nSquared, nBytes * 2),
  }
}

export function deserialisePublicKey(n: string): PaillierPublicKey {
  return publicKeyFromN(hexToBigInt(n))
}
