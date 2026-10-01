/**
 * AES-256-GCM for personally identifying data at rest.
 *
 * Stored layout: iv (12 bytes) ‖ authTag (16 bytes) ‖ ciphertext. GCM is authenticated, so
 * a tampered record fails to decrypt rather than returning plausible nonsense.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_BYTES = 12
const TAG_BYTES = 16

function keyFrom(hexKey: string): Buffer {
  const key = Buffer.from(hexKey.replace(/^0x/, ''), 'hex')
  if (key.length !== 32) throw new Error('PII_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)')
  return key
}

export function encryptPii(plaintext: string | Buffer, hexKey: string): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(hexKey), iv)
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
}

export function decryptPii(payload: Buffer, hexKey: string): Buffer {
  if (payload.length < IV_BYTES + TAG_BYTES) throw new Error('Encrypted payload is truncated')
  const iv = payload.subarray(0, IV_BYTES)
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(hexKey), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)), decipher.final()])
}

export function decryptPiiToString(payload: Buffer, hexKey: string): string {
  return decryptPii(payload, hexKey).toString('utf8')
}
