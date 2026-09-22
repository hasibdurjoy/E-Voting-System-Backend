import { env } from '../config/env.js'
import {
  getProvider,
  getReadOnlyContract,
  getWallet,
  isContractConfigured,
  isProviderConfigured,
  isWalletConfigured,
} from '../blockchain/index.js'
import { ApiError } from '../utils/ApiError.js'
import { logger } from '../utils/logger.js'

export interface BlockchainStatus {
  providerConfigured: boolean
  contractConfigured: boolean
  walletConfigured: boolean
  chainId?: string
  networkName?: string
  blockNumber?: number
  contractAddress?: string
  contractOwner?: string
  backendWalletAddress?: string
}

/** Connectivity check for the configured RPC node, contract and backend signer. */
export async function getBlockchainStatus(): Promise<BlockchainStatus> {
  const status: BlockchainStatus = {
    providerConfigured: isProviderConfigured(),
    contractConfigured: isContractConfigured(),
    walletConfigured: isWalletConfigured(),
  }
  if (!status.providerConfigured) return status

  try {
    const provider = getProvider()
    const [network, blockNumber] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()])
    status.chainId = network.chainId.toString()
    status.networkName = network.name
    status.blockNumber = blockNumber

    if (status.contractConfigured) {
      status.contractAddress = env.CONTRACT_ADDRESS
      status.contractOwner = (await getReadOnlyContract().getFunction('owner')()) as string
    }
    if (status.walletConfigured) {
      status.backendWalletAddress = getWallet().address
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    // Log details server-side only: RPC errors can contain the provider URL (and its API key).
    logger.error('Blockchain status check failed', error)
    throw ApiError.serviceUnavailable('Blockchain node unreachable or contract call failed')
  }

  return status
}
