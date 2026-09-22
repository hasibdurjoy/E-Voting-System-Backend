import { JsonRpcProvider } from 'ethers'
import { env } from '../config/env.js'
import { ApiError } from '../utils/ApiError.js'

let provider: JsonRpcProvider | undefined

export function isProviderConfigured(): boolean {
  return Boolean(env.BLOCKCHAIN_RPC_URL)
}

/** Lazily creates a shared JSON-RPC provider for BLOCKCHAIN_RPC_URL. */
export function getProvider(): JsonRpcProvider {
  if (!env.BLOCKCHAIN_RPC_URL) {
    throw ApiError.serviceUnavailable('Blockchain provider is not configured (BLOCKCHAIN_RPC_URL is missing)')
  }
  provider ??= new JsonRpcProvider(env.BLOCKCHAIN_RPC_URL)
  return provider
}
