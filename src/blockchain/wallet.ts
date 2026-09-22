import { Wallet } from 'ethers'
import { env } from '../config/env.js'
import { ApiError } from '../utils/ApiError.js'
import { getProvider } from './provider.js'

let wallet: Wallet | undefined

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
