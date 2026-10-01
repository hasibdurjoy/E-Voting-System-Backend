/** Shared big-integer helpers. All values crossing the wire are big-endian and zero-padded. */
import { randomBytes } from 'node:crypto'

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n
  if (exponent < 0n) return modPow(modInverse(base, modulus), -exponent, modulus)

  let result = 1n
  let b = ((base % modulus) + modulus) % modulus
  let e = exponent
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus
    b = (b * b) % modulus
    e >>= 1n
  }
  return result
}

/** Extended Euclid. Throws when `value` is not invertible — never silently returns a wrong answer. */
export function modInverse(value: bigint, modulus: bigint): bigint {
  let [old_r, r] = [((value % modulus) + modulus) % modulus, modulus]
  let [old_s, s] = [1n, 0n]
  while (r !== 0n) {
    const quotient = old_r / r
    ;[old_r, r] = [r, old_r - quotient * r]
    ;[old_s, s] = [s, old_s - quotient * s]
  }
  if (old_r !== 1n) throw new Error('Value is not invertible modulo the given modulus')
  return ((old_s % modulus) + modulus) % modulus
}

export function gcd(a: bigint, b: bigint): bigint {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b]
  while (y) [x, y] = [y, x % y]
  return x
}

/** Cryptographically secure random value in [1, bound). */
export function randomBelow(bound: bigint): bigint {
  if (bound <= 1n) throw new Error('Bound must be greater than 1')
  const byteLength = Math.ceil(bound.toString(16).length / 2)
  for (;;) {
    const value = bytesToBigInt(randomBytes(byteLength)) % bound
    if (value > 0n) return value
  }
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

export function hexToBigInt(hex: string): bigint {
  const normalised = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (normalised.length === 0) return 0n
  if (!/^[0-9a-fA-F]+$/.test(normalised)) throw new Error('Value is not valid hexadecimal')
  return BigInt(`0x${normalised}`)
}

/**
 * Big-endian hex of `value`, zero-padded to exactly `byteLength` bytes.
 * The contract rejects any ciphertext whose length is not exactly len(n²), so every
 * value that crosses the boundary goes through here.
 */
export function bigIntToHex(value: bigint, byteLength: number): string {
  if (value < 0n) throw new Error('Cannot encode a negative value')
  const hex = value.toString(16)
  if (hex.length > byteLength * 2) throw new Error('Value does not fit in the requested width')
  return `0x${hex.padStart(byteLength * 2, '0')}`
}

/** Byte width of a 0x-prefixed hex string. */
export function hexByteLength(hex: string): number {
  return (hex.startsWith('0x') ? hex.length - 2 : hex.length) / 2
}

/** Minimum number of bytes needed to represent `value`. */
export function byteLengthOf(value: bigint): number {
  return Math.ceil(value.toString(16).length / 2)
}
