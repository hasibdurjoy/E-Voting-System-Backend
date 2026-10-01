import { NonceManager, Wallet } from 'ethers'
import { env } from '../config/env.js'
import { ApiError } from '../utils/ApiError.js'
import { getProvider } from './provider.js'

let wallet: Wallet | undefined
let signer: NonceManager | undefined

export function isWalletConfigured(): boolean {
  return Boolean(env.BACKEND_PRIVATE_KEY)
}

/**
 * Backend signer connected to the shared provider.
 * The private key is read from the environment only and is never logged or returned.
 */
export function getWallet(): Wallet {
  if (!env.BACKEND_PRIVATE_KEY) {
    throw ApiError.serviceUnavailable('Backend wallet is not configured (BACKEND_PRIVATE_KEY is missing)')
  }
  wallet ??= new Wallet(env.BACKEND_PRIVATE_KEY, getProvider())
  return wallet
}

/**
 * The signer used for writes: the wallet wrapped in a nonce manager.
 *
 * Asking the node for the nonce on every send is not reliable enough. Two transactions
 * submitted close together can both read the same "latest" count — the node has not mined
 * the first yet — and the second is then rejected as a replacement. The nonce manager
 * assigns them locally and in order instead.
 *
 * It is belt and braces with the relayer's queue: the queue keeps one transaction in flight,
 * the nonce manager keeps the numbering correct if anything ever bypasses the queue.
 */
export function getRelayerSigner(): NonceManager {
  signer ??= new NonceManager(getWallet())
  return signer
}

/**
 * Drops the locally tracked nonce after a failed send, so the next attempt re-reads it from
 * the chain. Without this, one rejected transaction would leave the counter permanently
 * ahead and every later write would stall.
 */
export function resetRelayerNonce(): void {
  signer?.reset()
}
