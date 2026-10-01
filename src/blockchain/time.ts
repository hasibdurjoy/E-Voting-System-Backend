/**
 * The chain's notion of "now".
 *
 * Election windows are enforced by the contract against `block.timestamp`, so every
 * server-side pre-check has to use the same clock. Comparing against the server's wall
 * clock instead looks equivalent — the two usually agree within seconds — but they can
 * diverge (a development node that has mined a burst of blocks runs ahead, a public chain
 * lags), and then the API cheerfully reports a voter as eligible for a ballot the contract
 * is about to reject.
 *
 * Cached for a second: the value only changes when a block is mined, and eligibility is
 * checked on nearly every page.
 */
import { getProvider } from './provider.js'

const CACHE_MS = 1000

let cachedAt = 0
let cached: Date | null = null

export async function getChainTime(): Promise<Date> {
  const now = Date.now()
  if (cached && now - cachedAt < CACHE_MS) return cached

  const block = await getProvider().getBlock('latest')
  const timestamp = block?.timestamp

  // The later of the two clocks, because each is wrong in a different direction:
  //   - the last block's timestamp lags whenever no block has been mined recently, which on
  //     an idle development chain can be minutes;
  //   - the server's clock lags whenever the chain has been pushed ahead.
  // The next block will carry at least both, so taking the later of the two is the closest
  // estimate of the timestamp the contract will actually see.
  // A chain that cannot report a block is a bigger problem than a stale clock; falling back
  // to the server's time keeps reads working rather than failing the whole request.
  const chainMillis = timestamp ? Number(timestamp) * 1000 : 0
  cached = new Date(Math.max(chainMillis, now))
  cachedAt = now
  return cached
}

/** Clears the cache — used by tests and after a chain restart. */
export function resetChainTimeCache(): void {
  cached = null
  cachedAt = 0
}
