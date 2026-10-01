/**
 * Threshold Paillier decryption (Damgård–Jurik / Fouque–Poupard–Stern).
 *
 * The election private key is never held by one party. It is shared across `l` trustees
 * such that any `k` of them can open the *aggregate* tally, and any `k−1` learn nothing.
 *
 * References:
 *   Damgård & Jurik, "A Generalisation, a Simplification and Some Applications of
 *     Paillier's Probabilistic Public-Key System" (PKC 2001)
 *   Fouque, Poupard & Stern, "Sharing Decryption in the Context of Voting or Lotteries"
 *     (FC 2000)
 *
 * Setup (once per election, before `setElectionKey`):
 *
 *     p = 2p'+1, q = 2q'+1   safe primes         n = pq,  m = p'q'
 *     d ≡ 0 (mod m),  d ≡ 1 (mod n)              by CRT
 *     f(X) = d + a₁X + … + a_{k−1}X^{k−1}  over Z_{nm},   sᵢ = f(i)
 *     Δ = l!                                      vᵢ = v^{Δ·sᵢ} mod n²
 *
 * Partial decryption (each trustee, on the aggregate c):   cᵢ = c^{2Δsᵢ} mod n²
 *
 * Combination over any k-subset S:
 *
 *     μᵢ = Δ · ∏_{j∈S\{i}} (−j)/(i−j)             integer Lagrange coefficients
 *     c' = ∏ cᵢ^{2μᵢ} = c^{4Δ²d} mod n²
 *     M  = L(c') · (4Δ²)⁻¹ mod n
 *
 * The 4 is not decorative: |Z*_{n²}| = n·4m, so the randomiser rⁿ only vanishes once the
 * exponent carries that factor. Dropping it yields plausible-looking garbage.
 *
 * WHAT THIS DOES NOT DO: there is no zero-knowledge proof that a trustee computed its
 * share honestly, and no distributed key generation — the backend knows the whole key at
 * setup time and must discard it. Both are documented limitations, not oversights.
 */
import { bigIntToHex, hexToBigInt, modInverse, modPow, randomBelow } from './bigint.js'
import { L, type PaillierPrivateKey, type PaillierPublicKey } from './paillier.js'

export interface TrusteeShare {
  /** 1-based trustee index — it is the x-coordinate of the Shamir evaluation. */
  index: number
  /** sᵢ = f(i). SECRET: belongs to exactly one trustee and is never persisted here. */
  value: bigint
  /** vᵢ = v^{Δ·sᵢ} mod n² — public, lets others check the share is well-formed. */
  verificationKey: bigint
}

export interface ThresholdSetup {
  threshold: number
  trusteeCount: number
  /** Δ = l! */
  delta: bigint
  /** Public verification base. */
  v: bigint
  shares: TrusteeShare[]
}

function factorial(value: number): bigint {
  let result = 1n
  for (let i = 2n; i <= BigInt(value); i++) result *= i
  return result
}

/**
 * Splits the private key across `trusteeCount` trustees, any `threshold` of whom can
 * decrypt. A threshold of 1 is refused here as well as on-chain: it would mean a single
 * trustee could open every ballot, which is the exact property the scheme exists to deny.
 */
export function createThresholdSetup(
  publicKey: PaillierPublicKey,
  privateKey: PaillierPrivateKey,
  trusteeCount: number,
  threshold: number,
): ThresholdSetup {
  if (!Number.isInteger(trusteeCount) || trusteeCount < 2) throw new Error('At least two trustees are required')
  if (!Number.isInteger(threshold) || threshold < 2) throw new Error('Threshold must be at least 2')
  if (threshold > trusteeCount) throw new Error('Threshold cannot exceed the number of trustees')

  const { n, nSquared } = publicKey
  const m = ((privateKey.p - 1n) / 2n) * ((privateKey.q - 1n) / 2n) // p'q'

  // d ≡ 0 (mod m) and d ≡ 1 (mod n): d = m·(m⁻¹ mod n), reduced mod n·m.
  const d = (m * modInverse(m % n, n)) % (n * m)

  // Shamir over Z_{nm}: f(X) = d + a₁X + … + a_{k−1}X^{k−1}
  const modulus = n * m
  const coefficients = [d]
  for (let i = 1; i < threshold; i++) coefficients.push(randomBelow(modulus))

  const delta = factorial(trusteeCount)
  const v = modPow(randomBelow(n), 2n, nSquared) // a square, so it generates the right subgroup

  const shares: TrusteeShare[] = []
  for (let index = 1; index <= trusteeCount; index++) {
    let value = 0n
    let power = 1n
    for (const coefficient of coefficients) {
      value = (value + coefficient * power) % modulus
      power = (power * BigInt(index)) % modulus
    }
    shares.push({ index, value, verificationKey: modPow(v, delta * value, nSquared) })
  }

  return { threshold, trusteeCount, delta, v, shares }
}

/** cᵢ = c^{2Δsᵢ} mod n² — run by the trustee, on the trustee's own machine. */
export function partialDecrypt(
  ciphertext: bigint,
  share: Pick<TrusteeShare, 'value'>,
  delta: bigint,
  publicKey: PaillierPublicKey,
): bigint {
  return modPow(ciphertext, 2n * delta * share.value, publicKey.nSquared)
}

export interface PartialDecryption {
  index: number
  value: bigint
}

/**
 * Integer Lagrange coefficient μᵢ = Δ · ∏_{j∈S\{i}} (−j)/(i−j).
 * Δ = l! guarantees the quotient is an integer, so this is exact division, not rounding.
 */
function lagrangeCoefficient(index: number, subset: number[], delta: bigint): bigint {
  let numerator = delta
  let denominator = 1n
  for (const j of subset) {
    if (j === index) continue
    numerator *= BigInt(-j)
    denominator *= BigInt(index - j)
  }
  if (numerator % denominator !== 0n) throw new Error('Lagrange coefficient is not an integer')
  return numerator / denominator
}

/**
 * Combines any `threshold` partial decryptions into the plaintext tally.
 * Supplying fewer than `threshold` shares does not throw — it returns a wrong number,
 * which is why the caller must enforce the count and the tests assert on it.
 */
export function combineShares(
  partials: PartialDecryption[],
  delta: bigint,
  publicKey: PaillierPublicKey,
  threshold: number,
): bigint {
  const seen = new Set<number>()
  for (const partial of partials) {
    if (seen.has(partial.index)) throw new Error(`Duplicate decryption share for trustee ${partial.index}`)
    seen.add(partial.index)
  }
  if (partials.length < threshold) {
    throw new Error(`Need at least ${threshold} decryption shares, received ${partials.length}`)
  }

  const { n, nSquared } = publicKey
  const subset = partials.slice(0, threshold)
  const indices = subset.map((partial) => partial.index)

  let product = 1n
  for (const partial of subset) {
    const coefficient = 2n * lagrangeCoefficient(partial.index, indices, delta)
    product = (product * modPow(partial.value, coefficient, nSquared)) % nSquared
  }

  // c' = c^{4Δ²d}; with d ≡ 1 (mod n) this is (1+n)^{4Δ²M}, so L(c') = 4Δ²M mod n.
  const constant = modInverse((4n * delta * delta) % n, n)
  return (L(product, n) * constant) % n
}

/**
 * Unpacks the base-B packed plaintext into per-candidate totals.
 *
 * A ballot for ballot index i is the plaintext Bⁱ, so summing ballots keeps each
 * candidate's counter in its own base-B digit. B must exceed the largest possible total,
 * or one candidate's votes carry into the next and both numbers are wrong.
 */
export function unpackTotals(packed: bigint, candidateCount: number, ballotBase: bigint): number[] {
  if (candidateCount < 0) throw new Error('Candidate count cannot be negative')
  const totals: number[] = []
  let rest = packed
  for (let i = 0; i < candidateCount; i++) {
    totals.push(Number(rest % ballotBase))
    rest /= ballotBase
  }
  if (rest !== 0n) {
    // Either the base overflowed or the ciphertext was not a sum of well-formed ballots.
    throw new Error('Decrypted tally does not fit the approved candidate count')
  }
  return totals
}

/** Packs a ballot the way the frontend does — tests use it to build a known tally. */
export function packBallot(ballotIndex: number, ballotBase: bigint): bigint {
  if (!Number.isInteger(ballotIndex) || ballotIndex < 0) throw new Error('Ballot index must be a non-negative integer')
  return ballotBase ** BigInt(ballotIndex)
}

// ── Wire format ──────────────────────────────────────────────────────────────
// Shares are submitted on-chain as bytes, padded to len(n²) exactly like ciphertexts.

export function serialiseShare(value: bigint, publicKey: PaillierPublicKey): string {
  return bigIntToHex(value, publicKey.ciphertextBytes)
}

export function deserialiseShare(hex: string): bigint {
  return hexToBigInt(hex)
}

/** Serialises a trustee's secret share for out-of-band delivery. Never store the result. */
export function serialiseTrusteeShare(share: TrusteeShare, delta: bigint): string {
  return JSON.stringify({
    index: share.index,
    value: share.value.toString(16),
    verificationKey: share.verificationKey.toString(16),
    delta: delta.toString(16),
  })
}

export function deserialiseTrusteeShare(serialised: string): { index: number; value: bigint; delta: bigint } {
  const parsed: unknown = JSON.parse(serialised)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Malformed trustee share')
  const { index, value, delta } = parsed as Record<string, unknown>
  if (typeof index !== 'number' || typeof value !== 'string' || typeof delta !== 'string') {
    throw new Error('Malformed trustee share')
  }
  return { index, value: hexToBigInt(value), delta: hexToBigInt(delta) }
}
