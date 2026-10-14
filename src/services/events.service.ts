/**
 * Chain → database reconciliation.
 *
 * The contract is authoritative; Mongo is a cache that exists to make reads fast and to
 * hold the fields the chain does not store. This listener keeps the two in step.
 *
 * It replays from the last processed block on startup, so events that landed while the
 * backend was down are not silently missed — the usual cause of a dashboard that is
 * permanently one approval behind reality.
 */
import type { Contract, Log } from 'ethers'
import { getProvider, getReadOnlyContract, isContractConfigured, isProviderConfigured } from '../blockchain/index.js'
import { env } from '../config/env.js'
import { Candidate, DecryptionSession, Election, EventCursor, Trustee, Upazila, User, VoteReceipt } from '../models/index.js'
import { ElectionStatus } from '../types/domain.js'
import { logger } from '../utils/logger.js'

const CURSOR_NAME = 'voting-registry'
/** Blocks to re-scan on startup, so a reorg near the tip cannot strand an event. */
const REPLAY_SAFETY_MARGIN = 5

let started = false
let pollTimer: NodeJS.Timeout | null = null

type EventArgs = Record<string, unknown> & { [index: number]: unknown }

async function handleVoterRegistered(args: EventArgs, log: Log): Promise<void> {
  const commitment = String(args[0])
  await User.updateOne({ voterCommitment: commitment }, { $set: { registrationTxHash: log.transactionHash } })
}

async function handleVoterRevoked(args: EventArgs): Promise<void> {
  await User.updateOne({ voterCommitment: String(args[0]) }, { $set: { revoked: true } })
}

async function handleUpazilaRegistered(args: EventArgs, log: Log): Promise<void> {
  const upazilaId = Number(args[0])
  await Upazila.updateOne(
    { upazilaId },
    { $set: { name: String(args[1]), txHash: log.transactionHash } },
    { upsert: true },
  )
}

/** The chain is authoritative for a voter's area, including after a transfer. */
async function handleVoterAreaChanged(args: EventArgs): Promise<void> {
  await User.updateOne({ voterCommitment: String(args[0]) }, { $set: { upazilaId: Number(args[2]) } })
}

async function handleVoterHoldChanged(args: EventArgs): Promise<void> {
  await User.updateOne({ voterCommitment: String(args[0]) }, { $set: { onHold: Boolean(args[1]) } })
}

async function handleElectionStatusChanged(args: EventArgs): Promise<void> {
  const electionId = Number(args[0])
  const status = Number(args[1])
  const update: Record<string, unknown> = { status }
  if (status === ElectionStatus.Closed) update.closedAt = new Date()
  await Election.updateOne({ chainElectionId: electionId }, { $set: update })
}

async function handleCandidateStatusChanged(args: EventArgs): Promise<void> {
  const electionId = Number(args[0])
  const candidateId = Number(args[1])
  const status = Number(args[2])
  const ballotIndex = Number(args[3])

  // ballotIndex is assigned by the contract on approval — this is the authoritative copy.
  await Candidate.updateOne(
    { chainElectionId: electionId, chainCandidateId: candidateId },
    { $set: { status, ballotIndex: status === 2 ? ballotIndex : null } },
  )
}

async function handleVoteCast(_args: EventArgs, log: Log): Promise<void> {
  await VoteReceipt.updateOne(
    { txHash: log.transactionHash },
    { $set: { confirmed: true, blockNumber: log.blockNumber } },
  )
}

async function handleDecryptionShareSubmitted(args: EventArgs, log: Log): Promise<void> {
  const electionId = Number(args[0])
  const trustee = String(args[1]).toLowerCase()
  const sharesSoFar = Number(args[2])

  await Trustee.updateOne(
    { chainElectionId: electionId, address: trustee },
    { $set: { shareSubmittedAt: new Date(), shareTxHash: log.transactionHash } },
  )
  await DecryptionSession.updateOne({ chainElectionId: electionId }, { $set: { sharesSubmitted: sharesSoFar } })
}

async function handleResultPublished(args: EventArgs, log: Log): Promise<void> {
  const electionId = Number(args[0])
  const totals = (args[1] as bigint[]).map(Number)
  await DecryptionSession.updateOne(
    { chainElectionId: electionId },
    { $set: { totals, publishTxHash: log.transactionHash, combinedAt: new Date() } },
  )
  await Election.updateOne(
    { chainElectionId: electionId },
    { $set: { status: ElectionStatus.ResultsPublished, 'txHashes.published': log.transactionHash } },
  )
}

const HANDLERS: Record<string, (args: EventArgs, log: Log) => Promise<void>> = {
  UpazilaRegistered: handleUpazilaRegistered,
  VoterRegistered: handleVoterRegistered,
  VoterRevoked: handleVoterRevoked,
  VoterAreaChanged: handleVoterAreaChanged,
  VoterHoldChanged: handleVoterHoldChanged,
  ElectionStatusChanged: handleElectionStatusChanged,
  CandidateStatusChanged: handleCandidateStatusChanged,
  VoteCast: handleVoteCast,
  DecryptionShareSubmitted: handleDecryptionShareSubmitted,
  ResultPublished: handleResultPublished,
}

async function readCursor(): Promise<number> {
  const cursor = await EventCursor.findOne({ name: CURSOR_NAME })
  return cursor?.lastProcessedBlock ?? 0
}

async function writeCursor(block: number): Promise<void> {
  await EventCursor.updateOne(
    { name: CURSOR_NAME },
    { $set: { lastProcessedBlock: block, updatedAt: new Date() } },
    { upsert: true },
  )
}

async function processRange(contract: Contract, fromBlock: number, toBlock: number): Promise<void> {
  if (fromBlock > toBlock) return

  const logs = await contract.queryFilter('*', fromBlock, toBlock)
  for (const log of logs) {
    const parsed = contract.interface.parseLog({ topics: [...log.topics], data: log.data })
    if (!parsed) continue
    const handler = HANDLERS[parsed.name]
    if (!handler) continue
    try {
      await handler(parsed.args as unknown as EventArgs, log)
    } catch (error) {
      logger.error(
        `Event ${parsed.name} in block ${log.blockNumber} could not be reconciled`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  await writeCursor(toBlock)
  if (logs.length > 0) logger.debug(`Reconciled ${logs.length} event(s) up to block ${toBlock}`)
}

/**
 * Starts polling for events. Polling rather than a websocket subscription because the local
 * Hardhat node and most hosted RPC endpoints serve HTTP, and a dropped socket that silently
 * stops delivering is worse than a loop that always catches up.
 */
export function startEventListener(intervalMs = 4000): void {
  if (started) return
  if (!isProviderConfigured() || !isContractConfigured()) {
    logger.warn('Event listener not started: the blockchain is not configured')
    return
  }

  started = true
  const contract = getReadOnlyContract()

  const tick = async () => {
    try {
      const head = await getProvider().getBlockNumber()
      const confirmed = head - (env.CONFIRMATIONS - 1)
      if (confirmed < 0) return

      const cursor = await readCursor()
      const from = cursor === 0 ? 0 : Math.max(0, cursor + 1 - REPLAY_SAFETY_MARGIN)
      if (from > confirmed) return

      await processRange(contract, from, confirmed)
    } catch (error) {
      logger.debug(`Event poll failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  void tick()
  pollTimer = setInterval(() => void tick(), intervalMs)
  pollTimer.unref()
  logger.info('Event listener started')
}

export function stopEventListener(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  started = false
}
