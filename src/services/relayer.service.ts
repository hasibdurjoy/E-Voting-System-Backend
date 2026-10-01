/**
 * The relayer — every on-chain write goes through here.
 *
 * Voters and admins do not hold gas or sign transactions; the backend signer does it on
 * their behalf. That makes this module the one place where three things must hold:
 *
 *   1. ONE TRANSACTION AT A TIME. Two concurrent sends from one signer pick the same nonce
 *      and one of them is dropped — silently, and under load rather than in testing. Every
 *      send is therefore queued.
 *   2. WAIT FOR CONFIRMATION before reporting success. A transaction hash means "accepted
 *      into the mempool", not "it happened".
 *   3. NEVER RETRY A VOTE. If castVote reverts with AlreadyVoted, that is terminal — a
 *      retry can only ever fail again, and offering one misleads the voter.
 */
import { formatEther, type Contract, type ContractTransactionReceipt, type TransactionResponse } from 'ethers'
import { getSignerContract, getWallet, resetRelayerNonce } from '../blockchain/index.js'
import { isNonceError, toApiError } from '../blockchain/errors.js'
import { env } from '../config/env.js'
import { ApiError } from '../utils/ApiError.js'
import { logger } from '../utils/logger.js'

export interface RelayResult<T = unknown> {
  txHash: string
  blockNumber: number
  /** Decoded return value, when the call has one (`registerCandidate` returns the id). */
  returnValue: T
  gasUsed: string
}

/** Serialises every send behind a single promise chain, so only one is ever in flight. */
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task)
  // Keep the chain alive even when a task rejects, otherwise one failure stops all writes.
  queue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

let balanceWarned = false

/** Logs once when the signer can no longer be relied on to fund an election. */
async function checkBalance(): Promise<void> {
  try {
    const wallet = getWallet()
    const balance = await wallet.provider!.getBalance(wallet.address)
    const threshold = BigInt(Math.round(env.RELAYER_MIN_BALANCE_ETH * 1e18))
    if (balance < threshold) {
      if (!balanceWarned) {
        logger.warn(
          `Relayer balance is low (${formatEther(balance)} ETH). ` +
            'If it reaches zero every write fails and the election halts.',
        )
        balanceWarned = true
      }
    } else {
      balanceWarned = false
    }
  } catch {
    // Balance monitoring must never be the reason a write fails.
  }
}

/**
 * Sends one contract call and waits for it to be mined.
 * `context` names the operation in logs and in the error that reaches the user.
 */
/**
 * Methods that must never be retried automatically.
 *
 * A vote is the obvious one: the spec is explicit that `AlreadyVoted` is terminal, and a
 * resend risks acting on a ballot whose fate is not yet known. The voter is told to try
 * again instead, which is a decision for them to make, not for the server.
 */
const NEVER_RETRY = new Set(['castVote'])

const NONCE_RETRY_DELAY_MS = 400

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sends one contract call and waits for it to be mined.
 * `context` names the operation in logs and in the error that reaches the user.
 */
export function relay<T = unknown>(
  context: string,
  method: string,
  args: unknown[],
  options: { simulateReturnValue?: boolean } = {},
): Promise<RelayResult<T>> {
  return enqueue(async () => {
    const attempts = NEVER_RETRY.has(method) ? 1 : 2

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const contract: Contract = getSignerContract()
      let returnValue: T = undefined as T

      try {
        // A static call first: it surfaces a revert as a decodable custom error before any
        // gas is spent, and it is the only way to read a non-view function's return value.
        if (options.simulateReturnValue) {
          returnValue = (await contract[method].staticCall(...args)) as T
        }

        const tx = (await contract[method](...args)) as TransactionResponse
        const receipt = (await tx.wait(env.CONFIRMATIONS)) as ContractTransactionReceipt | null

        if (!receipt) throw new Error('Transaction receipt was not returned')
        if (receipt.status !== 1) throw new Error('Transaction reverted on chain')

        logger.info(`${context}: ${method} confirmed in block ${receipt.blockNumber} (tx ${receipt.hash})`)
        void checkBalance()

        return {
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          returnValue,
          gasUsed: receipt.gasUsed.toString(),
        }
      } catch (error) {
        if (error instanceof ApiError) throw error

        // A nonce collision means this transaction never reached the chain. Re-reading the
        // nonce and sending once more is safe, and is the difference between a transient
        // RPC hiccup and a failed registration the voter has to redo.
        if (isNonceError(error) && attempt < attempts) {
          logger.warn(`${context}: nonce out of step, resynchronising and retrying once`)
          resetRelayerNonce()
          // Long enough to outlast the provider's short-lived nonce cache.
          await sleep(NONCE_RETRY_DELAY_MS)
          continue
        }

        // Any other failure may have left the locally tracked nonce ahead of the chain, so
        // clear it rather than stalling every later write behind a phantom transaction.
        resetRelayerNonce()
        throw toApiError(error, context)
      }
    }

    // Unreachable: the loop either returns or throws.
    throw toApiError(new Error('Transaction could not be sent'), context)
  })
}

/** True when the backend signer actually holds RELAYER_ROLE — reported by /api/blockchain/status. */
export async function isRelayerAuthorized(): Promise<boolean> {
  try {
    const contract = getSignerContract()
    const role = (await contract.RELAYER_ROLE()) as string
    return (await contract.hasRole(role, getWallet().address)) as boolean
  } catch {
    return false
  }
}

/** True when the signer also holds ELECTION_ADMIN_ROLE, which admin writes require. */
export async function isElectionAdminAuthorized(): Promise<boolean> {
  try {
    const contract = getSignerContract()
    const role = (await contract.ELECTION_ADMIN_ROLE()) as string
    return (await contract.hasRole(role, getWallet().address)) as boolean
  } catch {
    return false
  }
}
