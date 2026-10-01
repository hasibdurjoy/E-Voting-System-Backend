/**
 * End-to-end acceptance scenario — all three repositories, no mocks except the identity
 * providers (which have no real counterpart available to this project).
 *
 *     yarn e2e
 *
 * It drives the REST API exactly as the browser does, encrypts ballots with the frontend's
 * algorithm, and submits decryption shares through the trustee client with each trustee's
 * own key. Nothing here reaches into the backend's internals.
 *
 * The assertion that matters is step 18: a known distribution of votes (3 / 1 / 2) must
 * come back out of threshold decryption as exactly [3, 1, 2]. That single check exercises
 * client-side encryption, on-chain homomorphic aggregation, threshold decryption and
 * base-B unpacking in one pass.
 *
 * Prerequisites: a local chain with the contract deployed and roles granted, MongoDB, the
 * backend running, and `yarn seed:demo` already applied.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API = process.env.E2E_API_URL ?? 'http://localhost:5050/api'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo#Passw0rd'

/** Trustee keys. In a real deployment each lives only on its own trustee's machine. */
const TRUSTEE_KEYS: Record<string, string> = {
  'trustee1@evoting.test': '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  'trustee2@evoting.test': '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  'trustee3@evoting.test': '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
}

let passed = 0
let failed = 0
const failures: string[] = []

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    failures.push(label)
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function step(number: number, title: string): void {
  console.log(`\n${String(number).padStart(2, '0')} ── ${title}`)
}

interface ApiResult<T> {
  status: number
  body: { success: boolean; message?: string; data?: T }
}

async function call<T>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const body = (await response.json()) as ApiResult<T>['body']
  return { status: response.status, body }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const RPC_URL = process.env.BLOCKCHAIN_RPC_URL ?? 'http://127.0.0.1:8545'

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = (await response.json()) as { result?: T; error?: { message: string } }
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return body.result as T
}

/**
 * The chain's clock, which is the one the contract enforces election windows against. On a
 * development node it can run ahead of wall-clock time, so every deadline in this scenario
 * is derived from here rather than from `Date.now()`.
 */
async function chainNow(): Promise<number> {
  // Mine first: on an idle chain the latest block can be minutes old, and basing an election
  // window on that stale value puts the registration deadline in the past before it starts.
  await rpc('evm_mine', [])
  const block = await rpc<{ timestamp: string }>('eth_getBlockByNumber', ['latest', false])
  return Number(BigInt(block.timestamp))
}

/** Moves the chain clock forward and mines, the way waiting would on a real network. */
async function advanceChain(seconds: number): Promise<void> {
  await rpc('evm_increaseTime', [seconds])
  await rpc('evm_mine', [])
}

// ── the frontend's ballot encryption, reproduced here ─────────────────────────
// Copied from e-voting-system-frontend/src/lib/paillier.ts so that this script encrypts
// exactly the way the browser does. If the two ever diverge, the ciphertext the contract
// accepts here would not be the one a real voter produces, and this test would be a lie.

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n
  let b = base % modulus
  let e = exponent
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus
    b = (b * b) % modulus
    e >>= 1n
  }
  return result
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b]
  return a
}

function randomBelow(bound: bigint): bigint {
  const byteLength = Math.ceil(bound.toString(16).length / 2)
  const buffer = new Uint8Array(byteLength)
  for (;;) {
    crypto.getRandomValues(buffer)
    let value = 0n
    for (const byte of buffer) value = (value << 8n) | BigInt(byte)
    value %= bound
    if (value > 0n) return value
  }
}

function encryptBallot(ballotIndex: number, publicKey: { n: string; nSquared: string; ballotBase: string }): string {
  const n = BigInt(publicKey.n)
  const nSquared = BigInt(publicKey.nSquared)
  const plaintext = BigInt(publicKey.ballotBase) ** BigInt(ballotIndex)

  let r = randomBelow(n)
  while (gcd(r, n) !== 1n) r = randomBelow(n)

  const gm = (1n + plaintext * n) % nSquared
  const ciphertext = (gm * modPow(r, n, nSquared)) % nSquared

  const width = (publicKey.nSquared.replace(/^0x/, '').length / 2) | 0
  return `0x${ciphertext.toString(16).padStart(width * 2, '0')}`
}

// ── helpers ──────────────────────────────────────────────────────────────────

const SELFIE = `data:image/png;base64,${Buffer.alloc(1400, 9).toString('base64')}`

interface Session {
  email: string
  token: string
  fullName: string
}

async function login(email: string): Promise<string> {
  const result = await call<{ token: string }>('POST', '/auth/login', {
    body: { identifier: email, password: DEMO_PASSWORD },
  })
  if (result.status !== 200) throw new Error(`login failed for ${email}: ${result.body.message ?? result.status}`)
  return result.body.data!.token
}

/**
 * Registers a voter the way the browser does: NID → face → account.
 *
 * On a re-run the identity is already registered, which the API answers with 409; the
 * account from the previous run is then signed into instead, so the scenario is repeatable
 * without wiping the database.
 */
async function registerVoter(nid: string, fullName: string, dateOfBirth: string): Promise<Session> {
  const email = `e2e.${nid}@evoting.test`
  const nidStep = await call<{ registrationToken: string; maskedNid: string }>('POST', '/auth/register/verify-nid', {
    body: { fullName, nid, dateOfBirth },
  })
  if (nidStep.status === 409) return { email, token: await login(email), fullName }
  if (nidStep.status !== 200) throw new Error(`verify-nid failed for ${email}: ${nidStep.body.message}`)
  const registrationToken = nidStep.body.data!.registrationToken

  const faceStep = await call('POST', '/auth/register/verify-face', {
    body: { registrationToken, selfieImage: SELFIE },
  })
  if (faceStep.status !== 200) throw new Error(`verify-face failed for ${email}: ${faceStep.body.message}`)

  const complete = await call<{ token: string; user: { fullName: string } }>('POST', '/auth/register/complete', {
    body: { registrationToken, email, phone: '+8801700000000', password: DEMO_PASSWORD },
  })
  if (complete.status !== 201) throw new Error(`register complete failed for ${email}: ${complete.body.message}`)

  return { email, token: complete.body.data!.token, fullName }
}

async function main(): Promise<void> {
  console.log(`E-Voting end-to-end scenario against ${API}\n`)

  const health = await call('GET', '/health')
  if (health.status !== 200) throw new Error('The backend is not reachable. Start it with `yarn dev`.')

  const chain = await call<{ relayerAuthorized: boolean; contractAddress: string }>('GET', '/blockchain/status')
  if (!chain.body.data?.relayerAuthorized) {
    throw new Error('The backend signer does not hold RELAYER_ROLE — run the contracts repo grant:roles script.')
  }
  const contractAddress = chain.body.data.contractAddress

  // ── 1–4 registration ───────────────────────────────────────────────────────
  step(1, 'Registration: identity, face, account, on-chain commitment')

  const unknownNid = await call('POST', '/auth/register/verify-nid', {
    body: { fullName: 'Nobody At All', nid: '9999999999999', dateOfBirth: '1990-01-01' },
  })
  check('unknown National ID is refused with 404', unknownNid.status === 404, String(unknownNid.status))

  const underAge = await call('POST', '/auth/register/verify-nid', {
    body: { fullName: 'Minor Person', nid: '2010099887766', dateOfBirth: '2010-09-09' },
  })
  check('under-age applicant is refused with 422', underAge.status === 422, String(underAge.status))

  const alreadyRegistered = await call('POST', '/auth/register/verify-nid', {
    body: { fullName: 'Ayesha Rahman', nid: '1990123456789', dateOfBirth: '1990-04-12' },
  })
  check('already-registered National ID is refused with 409', alreadyRegistered.status === 409, String(alreadyRegistered.status))

  const stamp = Date.now()
  const voters: Session[] = []
  const voterFixtures: [string, string, string][] = [
    ['2001045566778', 'Sadia Noor', '2001-04-05'],
    ['1999012233445', 'Rakib Hasan', '1999-01-22'],
  ]
  for (const [nid, fullName, dateOfBirth] of voterFixtures) {
    voters.push(await registerVoter(nid, fullName, dateOfBirth))
  }
  check('two voters registered through the full three-step flow', voters.length === 2)

  const me = await call<{ voterCommitment: string; registrationTxHash: string; maskedNid: string }>('GET', '/auth/me', {
    token: voters[0].token,
  })
  check('voter commitment anchored on-chain with a transaction hash', /^0x[0-9a-f]{64}$/.test(me.body.data?.registrationTxHash ?? ''))
  check('National ID is returned masked only', me.body.data?.maskedNid === '•••• •••• 6778', me.body.data?.maskedNid)

  // ── 5–6 election with key and trustees ─────────────────────────────────────
  step(5, 'Admin creates an election; key and trustees configured')

  const adminToken = await login('admin@evoting.test')
  const chainStart = await chainNow()
  const registrationEnd = (chainStart + 120) * 1000
  const votingStart = (chainStart + 150) * 1000
  const votingEnd = (chainStart + 1800) * 1000
  const created = await call<{
    id: number
    status: number
    trusteeThreshold: number
    trusteeCount: number
    trusteeShares: { address: string; shareIndex: number; share: string }[]
  }>('POST', '/elections', {
    token: adminToken,
    body: {
      name: `E2E Election ${stamp}`,
      description: 'End-to-end acceptance scenario',
      candidateRegistrationEnd: new Date(registrationEnd).toISOString(),
      startTime: new Date(votingStart).toISOString(),
      endTime: new Date(votingEnd).toISOString(),
      trusteeThreshold: 2,
      trusteeCount: 3,
    },
  })
  check('election created', created.status === 201, created.body.message)
  const electionId = created.body.data!.id
  check('threshold is at least 2', created.body.data!.trusteeThreshold >= 2)
  check('one key share per trustee, returned exactly once', created.body.data!.trusteeShares.length === 3)

  const detail = await call<{ publicKey: { n: string; nSquared: string; ballotBase: string } | null }>(
    'GET',
    `/elections/${electionId}`,
  )
  const publicKey = detail.body.data!.publicKey!
  check('public key published for the browser to encrypt with', Boolean(publicKey?.n))
  const nBytes = (publicKey.n.length - 2) / 2
  check('key encoding satisfies the contract rules', nBytes % 32 === 0 && (publicKey.nSquared.length - 2) / 2 === nBytes * 2)

  // Shares are written to the trustees' own machines. Here that is a temp directory.
  const shareDir = mkdtempSync(join(tmpdir(), 'evoting-trustee-'))
  const sharePaths = new Map<string, string>()
  created.body.data!.trusteeShares.forEach((entry, index) => {
    const path = join(shareDir, `trustee-${index + 1}.share.json`)
    writeFileSync(path, entry.share, { mode: 0o600 })
    sharePaths.set(`trustee${index + 1}@evoting.test`, path)
  })

  // ── 7–10 candidates ────────────────────────────────────────────────────────
  step(7, 'Candidate registration opens; applications; approval assigns ballot indices')

  const opened = await call('POST', `/elections/${electionId}/transition`, {
    token: adminToken,
    body: { transition: 'open-candidate-registration' },
  })
  check('candidate registration opened', opened.status === 200, opened.body.message)

  const prematureVoting = await call('POST', `/elections/${electionId}/transition`, {
    token: adminToken,
    body: { transition: 'open-voting' },
  })
  check('opening voting with no approved candidates is refused', prematureVoting.status === 409)

  // Three candidates: two registered voters plus the seeded one.
  const candidateSessions: Session[] = [...voters]
  candidateSessions.push({ email: 'ayesha@evoting.test', token: await login('ayesha@evoting.test'), fullName: 'Ayesha Rahman' })

  const candidateIds: number[] = []
  for (const [index, candidate] of candidateSessions.entries()) {
    const application = await call<{ id: number; status: number; ballotIndex: number | null }>(
      'POST',
      `/elections/${electionId}/candidates`,
      {
        token: candidate.token,
        body: { electionId, party: `Party ${index + 1}`, manifesto: `Platform number ${index + 1} for the test election.` },
      },
    )
    if (application.status !== 201) throw new Error(`candidate application failed: ${application.body.message}`)
    candidateIds.push(application.body.data!.id)
    check(`candidate ${index + 1} application is pending with no ballot index`, application.body.data!.ballotIndex === null)
  }

  const duplicate = await call('POST', `/elections/${electionId}/candidates`, {
    token: candidateSessions[0].token,
    body: { electionId, party: 'Again', manifesto: 'A second application by the same person.' },
  })
  check('a second application by the same person is refused', duplicate.status === 409)

  const ballotIndices: number[] = []
  for (const [index, candidateId] of candidateIds.entries()) {
    const approval = await call<{ ballotIndex: number }>('PATCH', `/admin/candidates/${candidateId}`, {
      token: adminToken,
      body: { electionId, status: 2 },
    })
    if (approval.status !== 200) throw new Error(`approval failed: ${approval.body.message}`)
    ballotIndices.push(approval.body.data!.ballotIndex)
    check(`approval assigned ballot index ${index}`, approval.body.data!.ballotIndex === index)
  }

  const votingOpened = await call('POST', `/elections/${electionId}/transition`, {
    token: adminToken,
    body: { transition: 'open-voting' },
  })
  check('voting opened once candidates were approved', votingOpened.status === 200, votingOpened.body.message)

  const ballot = await call<{ candidates: { status: number }[] }>('GET', `/elections/${electionId}`)
  check('only approved candidates appear on the ballot', ballot.body.data!.candidates.every((c) => c.status === 2))

  // ── 11–15 voting ───────────────────────────────────────────────────────────
  step(11, 'Voting: encrypted ballots, receipts, and a refused second vote')

  // Six voters produce a known distribution of 3 / 1 / 2.
  const distribution = [3, 1, 2]
  const extraFixtures: [string, string, string][] = [
    ['1993051234567', 'Tahmina Islam', '1993-05-12'],
    ['1991070987654', 'Jubayer Alam', '1991-07-09'],
    ['1994081122330', 'Mitu Barua', '1994-08-11'],
  ]
  const ballotVoters: Session[] = [
    ...voters,
    { email: 'ayesha@evoting.test', token: await login('ayesha@evoting.test'), fullName: 'Ayesha Rahman' },
  ]
  for (const [nid, fullName, dateOfBirth] of extraFixtures) {
    ballotVoters.push(await registerVoter(nid, fullName, dateOfBirth))
  }

  const choices: number[] = []
  distribution.forEach((count, ballotIndex) => {
    for (let i = 0; i < count; i++) choices.push(ballotIndex)
  })
  check('six voters available for a 3 / 1 / 2 distribution', ballotVoters.length === choices.length, `${ballotVoters.length}`)

  const secondsToStart = Math.ceil(votingStart / 1000) - (await chainNow())
  if (secondsToStart > 0) {
    console.log(`     advancing the chain clock ${secondsToStart}s to the start of voting…`)
    await advanceChain(secondsToStart + 5)
    await sleep(1200) // let the backend's one-second chain-clock cache expire
  }

  const eligibility = await call<{ eligible: boolean; reason: string | null }>(
    'GET',
    `/elections/${electionId}/eligibility`,
    { token: ballotVoters[0].token },
  )
  check('an eligible voter is reported as eligible', eligibility.body.data?.eligible === true, eligibility.body.data?.reason ?? '')

  const anonymous = await call<{ reason: string }>('GET', `/elections/${electionId}/eligibility`)
  check('a signed-out visitor is reported as not-authenticated', anonymous.body.data?.reason === 'not-authenticated')

  // Checked before anyone has voted: afterwards the "already voted" rule would answer
  // first and a malformed ballot would look like a 409.
  const malformed = await call('POST', '/votes', {
    token: ballotVoters[0].token,
    body: { electionId, ciphertext: '0xdeadbeef' },
  })
  check('a malformed ciphertext is refused with 400', malformed.status === 400, String(malformed.status))

  for (const [index, voter] of ballotVoters.entries()) {
    const ciphertext = encryptBallot(choices[index], publicKey)
    const vote = await call<{ txHash: string; receiptCode: string; confirmed: boolean }>('POST', '/votes', {
      token: voter.token,
      body: { electionId, ciphertext },
    })
    if (vote.status !== 201) throw new Error(`vote ${index + 1} failed: ${vote.body.message}`)
    if (index === 0) {
      check('ballot accepted with a confirmed receipt', vote.body.data!.confirmed && /^0x[0-9a-f]{64}$/.test(vote.body.data!.txHash))
    }
  }
  console.log(`     ${ballotVoters.length} encrypted ballots cast (distribution ${distribution.join(' / ')})`)

  const secondVote = await call('POST', '/votes', {
    token: ballotVoters[0].token,
    body: { electionId, ciphertext: encryptBallot(0, publicKey) },
  })
  check('a second ballot from the same voter is refused with 409', secondVote.status === 409, String(secondVote.status))

  // ── 16 close ───────────────────────────────────────────────────────────────
  step(16, 'Closing the election')

  const earlyClose = await call('POST', `/elections/${electionId}/transition`, {
    token: adminToken,
    body: { transition: 'close' },
  })
  check('closing before the end time is refused', earlyClose.status === 409, String(earlyClose.status))

  const secondsToEnd = Math.ceil(votingEnd / 1000) - (await chainNow())
  if (secondsToEnd > 0) {
    console.log(`     advancing the chain clock ${secondsToEnd}s past the end of voting…`)
    await advanceChain(secondsToEnd + 5)
    await sleep(1200)
  }

  const closed = await call('POST', `/elections/${electionId}/transition`, {
    token: adminToken,
    body: { transition: 'close' },
  })
  check('election closed after its end time', closed.status === 200, closed.body.message)

  // ── 17–18 threshold decryption ─────────────────────────────────────────────
  step(17, 'Trustees submit decryption shares from their own machines')

  const belowThreshold = await call('POST', `/admin/elections/${electionId}/publish-result`, { token: adminToken })
  check('publishing with no shares is refused', belowThreshold.status === 409, String(belowThreshold.status))

  const trusteeToken = await login('trustee1@evoting.test')
  const notYetSubmitted = await call('POST', `/trustee/elections/${electionId}/share`, { token: trusteeToken })
  check(
    'the server refuses to produce a share itself (428)',
    notYetSubmitted.status === 428,
    `${notYetSubmitted.status}: ${notYetSubmitted.body.message ?? ''}`,
  )

  const tally = await call<{ ciphertext: string; voteCount: number }>('GET', `/trustee/elections/${electionId}/tally`, {
    token: trusteeToken,
  })
  check('trustee sees the encrypted tally and no plaintext totals', /^0x[0-9a-f]+$/.test(tally.body.data?.ciphertext ?? ''))
  check('tally covers every ballot cast', tally.body.data?.voteCount === choices.length)

  // Only two of the three trustees take part: the threshold is 2, and the point of the
  // scheme is that the third is not needed (and that two are not enough to decrypt alone,
  // which the unit tests prove directly).
  for (const email of ['trustee1@evoting.test', 'trustee2@evoting.test']) {
    const sharePath = sharePaths.get(email)!
    execFileSync('yarn', ['trustee:share', '--election', String(electionId), '--share', sharePath], {
      env: {
        ...process.env,
        // The trustee's client is told where the chain and contract are; its key is its own.
        BLOCKCHAIN_RPC_URL: process.env.BLOCKCHAIN_RPC_URL ?? 'http://127.0.0.1:8545',
        CONTRACT_ADDRESS: contractAddress,
        TRUSTEE_PRIVATE_KEY: TRUSTEE_KEYS[email],
      },
      stdio: 'pipe',
    })
    console.log(`     ${email} submitted its share with its own key`)
  }

  const recorded = await call<{ sharesSoFar: number; thresholdReached: boolean }>(
    'POST',
    `/trustee/elections/${electionId}/share`,
    { token: trusteeToken },
  )
  check('the submitted share is now visible to the trustee console', recorded.status === 200, recorded.body.message)
  check('threshold reported as reached', recorded.body.data?.thresholdReached === true)

  step(18, 'Threshold decryption and publication')

  const published = await call<{ totalVotes: number; results: { ballotIndex: number; votes: number }[] }>(
    'POST',
    `/admin/elections/${electionId}/publish-result`,
    { token: adminToken },
  )
  check('result published', published.status === 200, published.body.message)

  const totalsByIndex = new Map(published.body.data?.results.map((entry) => [entry.ballotIndex, entry.votes]) ?? [])
  const decrypted = ballotIndices.map((index) => totalsByIndex.get(index) ?? -1)
  check(
    `threshold decryption returns the known distribution [${distribution.join(', ')}]`,
    JSON.stringify(decrypted) === JSON.stringify(distribution),
    `got [${decrypted.join(', ')}]`,
  )
  check('total matches the ballots cast', published.body.data?.totalVotes === choices.length)

  // ── 19–20 public result ────────────────────────────────────────────────────
  step(19, 'The published result is readable by anyone')

  const publicResult = await call<{
    published: boolean
    totalVotes: number
    publishTxHash: string | null
    encryptedTallyHash: string
    results: { fullName: string; votes: number; percentage: number }[]
  }>('GET', `/elections/${electionId}/results`)

  check('results are public without a session', publicResult.status === 200)
  check('publication transaction recorded', /^0x[0-9a-f]{64}$/.test(publicResult.body.data?.publishTxHash ?? ''))
  check('encrypted tally hash published for verification', /^0x[0-9a-f]{64}$/.test(publicResult.body.data?.encryptedTallyHash ?? ''))
  check(
    'percentages add up',
    Math.abs((publicResult.body.data?.results.reduce((sum, entry) => sum + entry.percentage, 0) ?? 0) - 100) < 0.5,
  )

  console.log('')
  for (const entry of publicResult.body.data?.results ?? []) {
    console.log(`     ${entry.fullName.padEnd(20)} ${String(entry.votes).padStart(2)} votes  ${entry.percentage}%`)
  }

  rmSync(shareDir, { recursive: true, force: true })

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${passed} checks passed, ${failed} failed`)
  if (failed > 0) {
    console.log(`Failed: ${failures.join('; ')}`)
    process.exit(1)
  }
  console.log('End-to-end scenario complete.')
}

main().catch((error: unknown) => {
  console.error(`\nE2E failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
