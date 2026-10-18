import type { Contract, ContractEventName, EventLog, Log } from 'ethers'
import { env } from '../config/env.js'

/**
 * queryFilter split into LOG_BLOCK_RANGE-sized requests. Hosted RPCs cap the block range of
 * eth_getLogs (Alchemy's free tier at 10 blocks), and a single wide query is rejected outright.
 */
export async function queryFilterChunked(
  contract: Contract,
  event: ContractEventName,
  fromBlock: number,
  toBlock: number,
): Promise<Array<EventLog | Log>> {
  const logs: Array<EventLog | Log> = []
  for (let start = fromBlock; start <= toBlock; start += env.LOG_BLOCK_RANGE) {
    const end = Math.min(start + env.LOG_BLOCK_RANGE - 1, toBlock)
    logs.push(...(await contract.queryFilter(event, start, end)))
  }
  return logs
}
