import { Contract, type InterfaceAbi } from 'ethers'
import { env } from '../config/env.js'
import { ApiError } from '../utils/ApiError.js'
import { VOTING_REGISTRY_ABI } from './abi/index.js'
import { getProvider } from './provider.js'
import { getRelayerSigner } from './wallet.js'

export function isContractConfigured(): boolean {
  return Boolean(env.CONTRACT_ADDRESS)
}

function getContractAddress(): string {
  if (!env.CONTRACT_ADDRESS) {
    throw ApiError.serviceUnavailable('Smart contract is not configured (CONTRACT_ADDRESS is missing)')
  }
  return env.CONTRACT_ADDRESS
}

/** Read-only contract instance (view calls only). */
export function getReadOnlyContract(): Contract {
  return new Contract(getContractAddress(), VOTING_REGISTRY_ABI as unknown as InterfaceAbi, getProvider())
}

/** Contract instance connected to the backend signer (can send transactions). */
export function getSignerContract(): Contract {
  return new Contract(getContractAddress(), VOTING_REGISTRY_ABI as unknown as InterfaceAbi, getRelayerSigner())
}
