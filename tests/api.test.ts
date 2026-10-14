/**
 * API behaviour: status codes, guards, validation and the rules the frontend renders
 * different screens for.
 *
 * The status code IS the contract here — the UI distinguishes "already registered" from
 * "not found" from "under age" by code, not by message text, so each is asserted.
 */
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { Candidate, Election, Trustee, User } from '../src/models/index.js'
import { CandidateStatus, ElectionStatus } from '../src/types/domain.js'
import { hashPassword } from '../src/services/auth.service.js'
import { generateCommitmentSalt, maskNid, nidLookupHash, voterCommitment } from '../src/crypto/commitment.js'
import { encryptPii } from '../src/crypto/pii.js'
import { env } from '../src/config/env.js'
import { fakeChain } from './helpers/fakeChain.js'

const app = createApp()

/** A 1 KB data URL: above the mock provider's "too small to be a face" threshold. */
const SELFIE = `data:image/png;base64,${Buffer.alloc(1200, 7).toString('base64')}`
const PASSWORD = 'Str0ng#Password'

const TRUSTEE_ADDRESSES = env.TRUSTEE_ADDRESSES

/** Areas the scripted chain knows about; mirrors the mock registry's fixtures. */
const UPAZILA_A = 101
const UPAZILA_B = 202

async function createUser(options: {
  nid: string
  email: string
  roles?: ('voter' | 'admin' | 'trustee')[]
  walletAddress?: string
  revoked?: boolean
  registerOnChain?: boolean
  fullName?: string
  upazilaId?: number
}) {
  const salt = generateCommitmentSalt()
  const commitment = voterCommitment(options.nid, salt)
  const upazilaId = options.upazilaId ?? UPAZILA_A
  if (options.registerOnChain !== false) fakeChain.registerVoter(commitment, '0x' + '0'.repeat(40), upazilaId)

  const user = await User.create({
    fullName: options.fullName ?? 'Test Person',
    nidEncrypted: encryptPii(options.nid, env.PII_ENCRYPTION_KEY),
    nidLookupHash: nidLookupHash(options.nid, env.NID_HMAC_PEPPER),
    nidMasked: maskNid(options.nid),
    commitmentSalt: encryptPii(salt, env.PII_ENCRYPTION_KEY),
    voterCommitment: commitment,
    dateOfBirth: new Date('1990-01-01T00:00:00Z'),
    upazilaId,
    email: options.email,
    phone: '+8801700000000',
    passwordHash: await hashPassword(PASSWORD),
    roles: options.roles ?? ['voter'],
    walletAddress: options.walletAddress?.toLowerCase() ?? null,
    revoked: options.revoked ?? false,
    registeredAt: new Date(),
  })
  return user
}

async function tokenFor(email: string): Promise<string> {
  const response = await request(app).post('/api/auth/login').send({ identifier: email, password: PASSWORD })
  expect(response.status).toBe(200)
  return (response.body.data as { token: string }).token
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

/** Builds an election through the admin API and returns its chain id. */
async function createElection(adminToken: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  const response = await request(app)
    .post('/api/elections')
    .set(auth(adminToken))
    .send({
      name: 'General Election 2026',
      description: 'A test election',
      candidateRegistrationEnd: new Date(now + 60_000).toISOString(),
      startTime: new Date(now + 120_000).toISOString(),
      endTime: new Date(now + 600_000).toISOString(),
      trusteeThreshold: 2,
      trusteeCount: 3,
      ...overrides,
    })
  return response
}

/** Drives an election all the way to open voting, with `count` approved candidates. */
async function openElectionWithCandidates(adminToken: string, applicants: { token: string }[]) {
  const created = await createElection(adminToken)
  expect(created.status).toBe(201)
  const electionId = (created.body.data as { id: number }).id

  await request(app)
    .post(`/api/elections/${electionId}/transition`)
    .set(auth(adminToken))
    .send({ transition: 'open-candidate-registration' })

  for (const applicant of applicants) {
    const application = await request(app)
      .post(`/api/elections/${electionId}/candidates`)
      .set(auth(applicant.token))
      .send({ electionId, party: 'Test Party', manifesto: 'A platform of at least ten characters.' })
    expect(application.status).toBe(201)
    const candidateId = (application.body.data as { id: number }).id
    await request(app)
      .patch(`/api/admin/candidates/${candidateId}`)
      .set(auth(adminToken))
      .send({ electionId, status: CandidateStatus.Approved })
  }

  await request(app)
    .post(`/api/elections/${electionId}/transition`)
    .set(auth(adminToken))
    .send({ transition: 'open-voting' })

  // Voting is open only inside the window, so wind the fixture's start time back.
  const election = fakeChain.elections.get(electionId)!
  election.startTime = BigInt(Math.floor(Date.now() / 1000) - 60)

  return electionId
}

function ciphertextFor(electionId: number, value = 3n): string {
  const nSquared = fakeChain.elections.get(electionId)!.publicKeyNSquared
  const width = (nSquared.length - 2) / 2
  return `0x${value.toString(16).padStart(width * 2, '0')}`
}

describe('health and envelope', () => {
  it('reports the API as running', async () => {
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ success: true, message: 'E-Voting System API is running' })
  })

  it('returns 404 JSON for an unknown route', async () => {
    const response = await request(app).get('/api/nope')
    expect(response.status).toBe(404)
    expect(response.body.success).toBe(false)
  })

  it('no longer answers 501 on any domain route', async () => {
    for (const path of ['/api/elections', '/api/auth/config', '/api/blockchain/status']) {
      const response = await request(app).get(path)
      expect(response.status).not.toBe(501)
    }
  })
})

describe('registration', () => {
  it('verifies a known National ID and issues a registration token', async () => {
    const response = await request(app)
      .post('/api/auth/register/verify-nid')
      .send({ fullName: 'Sadia Noor', nid: '2001045566778', dateOfBirth: '2001-04-05' })

    expect(response.status).toBe(200)
    expect(response.body.data.verified).toBe(true)
    expect(response.body.data.maskedNid).toBe('•••• •••• 6778')
    expect(response.body.data.registrationToken).toBeTruthy()
    // The raw NID must appear nowhere in the response.
    expect(JSON.stringify(response.body)).not.toContain('2001045566778')
  })

  it('404s an unknown National ID', async () => {
    const response = await request(app)
      .post('/api/auth/register/verify-nid')
      .send({ fullName: 'Nobody At All', nid: '9999999999999', dateOfBirth: '1990-01-01' })
    expect(response.status).toBe(404)
  })

  it('422s a name or date-of-birth mismatch', async () => {
    const wrongName = await request(app)
      .post('/api/auth/register/verify-nid')
      .send({ fullName: 'Wrong Name', nid: '2001045566778', dateOfBirth: '2001-04-05' })
    expect(wrongName.status).toBe(422)

    const wrongDob = await request(app)
      .post('/api/auth/register/verify-nid')
      .send({ fullName: 'Sadia Noor', nid: '2001045566778', dateOfBirth: '1999-01-01' })
    expect(wrongDob.status).toBe(422)
  })

  it('422s an applicant under the voting age', async () => {
    const response = await request(app)
      .post('/api/auth/register/verify-nid')
      .send({ fullName: 'Minor Person', nid: '2010099887766', dateOfBirth: '2010-09-09' })
    expect(response.status).toBe(422)
    expect(response.body.message).toMatch(/18/)
  })

  it('409s a National ID that is already registered — the dedicated UI state', async () => {
    await createUser({ nid: '1990123456789', email: 'ayesha@example.test' })
    const response = await request(app)
      .post('/api/auth/register/verify-nid')
      .send({ fullName: 'Ayesha Rahman', nid: '1990123456789', dateOfBirth: '1990-04-12' })
    expect(response.status).toBe(409)
  })

  it('410s a face step with an expired registration token', async () => {
    const response = await request(app)
      .post('/api/auth/register/verify-face')
      .send({ registrationToken: 'a'.repeat(32), selfieImage: SELFIE })
    expect(response.status).toBe(410)
  })

  it('422s an unusable selfie and 428s completion before the face step', async () => {
    const nid = await request(app)
      .post('/api/auth/register/verify-nid')
      .send({ fullName: 'Sadia Noor', nid: '2001045566778', dateOfBirth: '2001-04-05' })
    const registrationToken = nid.body.data.registrationToken as string

    const tooSmall = await request(app)
      .post('/api/auth/register/verify-face')
      .send({ registrationToken, selfieImage: `data:image/png;base64,${Buffer.alloc(40, 1).toString('base64')}` })
    expect(tooSmall.status).toBe(422)

    const premature = await request(app)
      .post('/api/auth/register/complete')
      .send({ registrationToken, email: 'sadia@example.test', phone: '+8801711111111', password: PASSWORD })
    expect(premature.status).toBe(428)
  })

  it('completes registration, anchors the commitment on-chain and never stores the raw NID', async () => {
    const nid = await request(app)
      .post('/api/auth/register/verify-nid')
      .send({ fullName: 'Sadia Noor', nid: '2001045566778', dateOfBirth: '2001-04-05' })
    const registrationToken = nid.body.data.registrationToken as string

    const face = await request(app)
      .post('/api/auth/register/verify-face')
      .send({ registrationToken, selfieImage: SELFIE })
    expect(face.status).toBe(200)

    const completed = await request(app)
      .post('/api/auth/register/complete')
      .send({ registrationToken, email: 'sadia@example.test', phone: '+8801711111111', password: PASSWORD })

    expect(completed.status).toBe(201)
    const session = completed.body.data as { token: string; user: { voterCommitment: string; registrationTxHash: string } }
    expect(session.token).toBeTruthy()
    expect(session.user.registrationTxHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(fakeChain.voters.has(session.user.voterCommitment)).toBe(true)

    // Stored under encryption: the plaintext NID is in no document field.
    const stored = await User.findOne({ email: 'sadia@example.test' }).select('+nidEncrypted +nidLookupHash')
    expect(JSON.stringify(stored!.toObject())).not.toContain('2001045566778')
    expect(stored!.nidMasked).toBe('•••• •••• 6778')
  })
})

describe('login', () => {
  beforeEach(async () => {
    await createUser({ nid: '2001045566778', email: 'voter@example.test' })
  })

  it('issues a token for correct credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'voter@example.test', password: PASSWORD })
    expect(response.status).toBe(200)
    expect(response.body.data.token).toBeTruthy()
  })

  it('accepts the National ID as an identifier', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ identifier: '2001045566778', password: PASSWORD })
    expect(response.status).toBe(200)
  })

  it('gives the same 401 for a wrong password and an unknown account', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'voter@example.test', password: 'not-the-password' })
    const unknownAccount = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'nobody@example.test', password: PASSWORD })

    expect(wrongPassword.status).toBe(401)
    expect(unknownAccount.status).toBe(401)
    // Identical message: anything else is an account-enumeration oracle.
    expect(wrongPassword.body.message).toBe(unknownAccount.body.message)
  })

  it('403s a revoked account', async () => {
    await createUser({ nid: '1990123456789', email: 'revoked@example.test', revoked: true })
    const response = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'revoked@example.test', password: PASSWORD })
    expect(response.status).toBe(403)
  })

  it('401s /auth/me without a token and returns the user with one', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401)

    const token = await tokenFor('voter@example.test')
    const me = await request(app).get('/api/auth/me').set(auth(token))
    expect(me.status).toBe(200)
    expect(me.body.data.email).toBe('voter@example.test')
    expect(me.body.data.maskedNid).toBe('•••• •••• 6778')
    // The session endpoint must report the area the same way login does — the UI reads
    // the voter's Upazila from here, and a null name renders as "Upazila 101".
    expect(me.body.data.upazilaId).toBe(UPAZILA_A)
    expect(me.body.data.upazilaName).toBeTruthy()
    expect(me.body.data.onHold).toBe(false)
  })

  it('reports the same area from login and from /auth/me', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'voter@example.test', password: PASSWORD })
    const me = await request(app).get('/api/auth/me').set(auth(login.body.data.token))

    expect(me.body.data.upazilaId).toBe(login.body.data.user.upazilaId)
    expect(me.body.data.upazilaName).toBe(login.body.data.user.upazilaName)
  })
})

describe('authorisation', () => {
  let voterToken: string
  let adminToken: string
  let trusteeToken: string

  beforeEach(async () => {
    await createUser({ nid: '2001045566778', email: 'voter@example.test' })
    await createUser({ nid: '1995077788899', email: 'admin@example.test', roles: ['admin'] })
    await createUser({
      nid: '1988061122334',
      email: 'trustee@example.test',
      roles: ['trustee'],
      walletAddress: TRUSTEE_ADDRESSES[0],
    })
    voterToken = await tokenFor('voter@example.test')
    adminToken = await tokenFor('admin@example.test')
    trusteeToken = await tokenFor('trustee@example.test')
  })

  const adminRoutes: [string, string][] = [
    ['get', '/api/admin/stats'],
    ['get', '/api/admin/voters'],
  ]

  it('rejects a voter and a trustee on every admin route', async () => {
    for (const [method, path] of adminRoutes) {
      for (const token of [voterToken, trusteeToken]) {
        const response = await (request(app) as never as Record<string, (p: string) => request.Test>)[method](path).set(
          auth(token),
        )
        expect(response.status).toBe(403)
      }
      const asAdmin = await (request(app) as never as Record<string, (p: string) => request.Test>)[method](path).set(
        auth(adminToken),
      )
      expect(asAdmin.status).toBe(200)
    }
  })

  it('rejects a voter and an admin on trustee routes', async () => {
    for (const token of [voterToken, adminToken]) {
      const response = await request(app).get('/api/trustee/elections').set(auth(token))
      expect(response.status).toBe(403)
    }
    const asTrustee = await request(app).get('/api/trustee/elections').set(auth(trusteeToken))
    expect(asTrustee.status).toBe(200)
  })

  it('401s protected routes without a token', async () => {
    for (const path of ['/api/admin/stats', '/api/trustee/elections', '/api/votes/me', '/api/candidates/me']) {
      expect((await request(app).get(path)).status).toBe(401)
    }
  })

  it('stops a voter reading another voter’s receipts', async () => {
    // /votes/me is scoped to the session user; there is no route that takes a voter id.
    const other = await createUser({ nid: '1999012233445', email: 'other@example.test' })
    const token = await tokenFor('voter@example.test')
    const response = await request(app).get('/api/votes/me').set(auth(token))
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([])
    expect(String(other._id)).not.toBe('')
  })
})

describe('elections and candidates', () => {
  let adminToken: string
  let voterToken: string
  let secondVoterToken: string

  beforeEach(async () => {
    await createUser({ nid: '1995077788899', email: 'admin@example.test', roles: ['admin'] })
    await createUser({ nid: '2001045566778', email: 'voter@example.test', fullName: 'Sadia Noor' })
    await createUser({ nid: '1999012233445', email: 'second@example.test', fullName: 'Rakib Hasan' })
    adminToken = await tokenFor('admin@example.test')
    voterToken = await tokenFor('voter@example.test')
    secondVoterToken = await tokenFor('second@example.test')
  })

  it('creates an election with a key and trustees, returning the shares exactly once', async () => {
    const response = await createElection(adminToken)
    expect(response.status).toBe(201)

    const data = response.body.data as {
      id: number
      status: number
      trusteeShares: { address: string; share: string }[]
      trusteeShareDelivery: string
    }
    expect(data.status).toBe(ElectionStatus.Draft)
    expect(data.trusteeShares).toHaveLength(3)
    expect(data.trusteeShareDelivery).toBe('one-time-response')

    // The shares exist in the response and NOWHERE else.
    const trustees = await Trustee.find({ chainElectionId: data.id })
    expect(trustees).toHaveLength(3)
    const persisted = JSON.stringify(trustees.map((trustee) => trustee.toObject()))
    for (const { share } of data.trusteeShares) {
      expect(persisted).not.toContain(JSON.parse(share).value)
    }

    const election = await Election.findOne({ chainElectionId: data.id })
    expect(election!.privateKeyRef).toMatch(/discarded/)
  })

  it('rejects a threshold below two', async () => {
    const response = await createElection(adminToken, { trusteeThreshold: 1 })
    expect(response.status).toBe(422)
  })

  it('rejects dates in the wrong order', async () => {
    const now = Date.now()
    const response = await createElection(adminToken, {
      startTime: new Date(now + 600_000).toISOString(),
      endTime: new Date(now + 120_000).toISOString(),
    })
    expect(response.status).toBe(422)
  })

  it('refuses to open voting with no approved candidates', async () => {
    const created = await createElection(adminToken)
    const electionId = (created.body.data as { id: number }).id

    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-candidate-registration' })

    const response = await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-voting' })

    expect(response.status).toBe(409)
  })

  it('refuses transitions taken out of order', async () => {
    const created = await createElection(adminToken)
    const electionId = (created.body.data as { id: number }).id
    const response = await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-voting' })
    expect(response.status).toBe(409)
  })

  it('accepts one application per voter and assigns a ballot index on approval', async () => {
    const created = await createElection(adminToken)
    const electionId = (created.body.data as { id: number }).id
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-candidate-registration' })

    const application = await request(app)
      .post(`/api/elections/${electionId}/candidates`)
      .set(auth(voterToken))
      .send({ electionId, party: 'Green', manifesto: 'A platform of at least ten characters.' })

    expect(application.status).toBe(201)
    const candidate = application.body.data as { id: number; status: number; ballotIndex: number | null }
    expect(candidate.status).toBe(CandidateStatus.Pending)
    expect(candidate.ballotIndex).toBeNull()

    const duplicate = await request(app)
      .post(`/api/elections/${electionId}/candidates`)
      .set(auth(voterToken))
      .send({ electionId, party: 'Green', manifesto: 'A platform of at least ten characters.' })
    expect(duplicate.status).toBe(409)

    const approved = await request(app)
      .patch(`/api/admin/candidates/${candidate.id}`)
      .set(auth(adminToken))
      .send({ electionId, status: CandidateStatus.Approved })

    expect(approved.status).toBe(200)
    expect((approved.body.data as { ballotIndex: number }).ballotIndex).toBe(0)

    const decidedAgain = await request(app)
      .patch(`/api/admin/candidates/${candidate.id}`)
      .set(auth(adminToken))
      .send({ electionId, status: CandidateStatus.Rejected, reason: 'changed my mind' })
    expect(decidedAgain.status).toBe(409)
  })

  it('requires a reason to reject', async () => {
    const created = await createElection(adminToken)
    const electionId = (created.body.data as { id: number }).id
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-candidate-registration' })
    const application = await request(app)
      .post(`/api/elections/${electionId}/candidates`)
      .set(auth(voterToken))
      .send({ electionId, party: '', manifesto: 'A platform of at least ten characters.' })
    const candidateId = (application.body.data as { id: number }).id

    const response = await request(app)
      .patch(`/api/admin/candidates/${candidateId}`)
      .set(auth(adminToken))
      .send({ electionId, status: CandidateStatus.Rejected })
    expect(response.status).toBe(400)
  })

  it('shows only approved candidates once voting opens', async () => {
    const created = await createElection(adminToken)
    const electionId = (created.body.data as { id: number }).id
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-candidate-registration' })

    const approvedApplication = await request(app)
      .post(`/api/elections/${electionId}/candidates`)
      .set(auth(voterToken))
      .send({ electionId, party: 'A', manifesto: 'A platform of at least ten characters.' })
    await request(app)
      .post(`/api/elections/${electionId}/candidates`)
      .set(auth(secondVoterToken))
      .send({ electionId, party: 'B', manifesto: 'Another platform, also long enough.' })

    // Both applications are visible while registration is open …
    const duringRegistration = await request(app).get(`/api/elections/${electionId}`)
    expect((duringRegistration.body.data as { candidates: unknown[] }).candidates).toHaveLength(2)

    await request(app)
      .patch(`/api/admin/candidates/${(approvedApplication.body.data as { id: number }).id}`)
      .set(auth(adminToken))
      .send({ electionId, status: CandidateStatus.Approved })
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-voting' })

    // … and only the approved one once the ballot is fixed.
    const afterOpening = await request(app).get(`/api/elections/${electionId}`)
    const candidates = (afterOpening.body.data as { candidates: { status: number }[] }).candidates
    expect(candidates).toHaveLength(1)
    expect(candidates[0].status).toBe(CandidateStatus.Approved)
  })

  it('exposes the public key needed to encrypt a ballot', async () => {
    const created = await createElection(adminToken)
    const electionId = (created.body.data as { id: number }).id
    const detail = await request(app).get(`/api/elections/${electionId}`)
    const publicKey = (detail.body.data as { publicKey: { n: string; nSquared: string; ballotBase: string } }).publicKey

    expect(publicKey.n).toMatch(/^0x[0-9a-f]+$/)
    // The contract's encoding rules: len(n) a multiple of 32, len(n²) exactly twice that.
    const nBytes = (publicKey.n.length - 2) / 2
    expect(nBytes % 32).toBe(0)
    expect((publicKey.nSquared.length - 2) / 2).toBe(nBytes * 2)
    expect(publicKey.ballotBase).toBe((2n ** 32n).toString())
  })

  it('404s an election that does not exist', async () => {
    expect((await request(app).get('/api/elections/99')).status).toBe(404)
  })
})

describe('voting', () => {
  let adminToken: string
  let voterToken: string
  let electionId: number

  beforeEach(async () => {
    await createUser({ nid: '1995077788899', email: 'admin@example.test', roles: ['admin'] })
    await createUser({ nid: '2001045566778', email: 'voter@example.test' })
    await createUser({ nid: '1999012233445', email: 'candidate@example.test' })
    adminToken = await tokenFor('admin@example.test')
    voterToken = await tokenFor('voter@example.test')
    const candidateToken = await tokenFor('candidate@example.test')
    electionId = await openElectionWithCandidates(adminToken, [{ token: candidateToken }])
  })

  it('reports eligibility for a signed-out visitor as not-authenticated', async () => {
    const response = await request(app).get(`/api/elections/${electionId}/eligibility`)
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ eligible: false, reason: 'not-authenticated' })
  })

  it('accepts one ballot and returns a receipt', async () => {
    const eligibility = await request(app).get(`/api/elections/${electionId}/eligibility`).set(auth(voterToken))
    expect(eligibility.body.data).toMatchObject({ eligible: true, reason: null, hasVoted: false })

    const response = await request(app)
      .post('/api/votes')
      .set(auth(voterToken))
      .send({ electionId, ciphertext: ciphertextFor(electionId) })

    expect(response.status).toBe(201)
    const receipt = response.body.data as { txHash: string; receiptCode: string; ciphertextHash: string; confirmed: boolean }
    expect(receipt.txHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(receipt.receiptCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(receipt.confirmed).toBe(true)
  })

  it('409s a second ballot — the terminal state the UI must not offer to retry', async () => {
    await request(app)
      .post('/api/votes')
      .set(auth(voterToken))
      .send({ electionId, ciphertext: ciphertextFor(electionId) })

    const second = await request(app)
      .post('/api/votes')
      .set(auth(voterToken))
      .send({ electionId, ciphertext: ciphertextFor(electionId, 5n) })

    expect(second.status).toBe(409)

    const eligibility = await request(app).get(`/api/elections/${electionId}/eligibility`).set(auth(voterToken))
    expect(eligibility.body.data).toMatchObject({ eligible: false, reason: 'already-voted', hasVoted: true })
    expect(eligibility.body.data.receipt).not.toBeNull()
  })

  it('400s a malformed ciphertext', async () => {
    const tooShort = await request(app).post('/api/votes').set(auth(voterToken)).send({ electionId, ciphertext: '0x1234' })
    expect(tooShort.status).toBe(400)

    const notReduced = await request(app)
      .post('/api/votes')
      .set(auth(voterToken))
      .send({ electionId, ciphertext: `0x${'f'.repeat((ciphertextFor(electionId).length - 2))}` })
    expect(notReduced.status).toBe(400)

    const notHex = await request(app).post('/api/votes').set(auth(voterToken)).send({ electionId, ciphertext: 'hello' })
    expect(notHex.status).toBe(400)
  })

  it('refuses a vote outside the voting window', async () => {
    const election = fakeChain.elections.get(electionId)!
    election.endTime = BigInt(Math.floor(Date.now() / 1000) - 1)

    const response = await request(app)
      .post('/api/votes')
      .set(auth(voterToken))
      .send({ electionId, ciphertext: ciphertextFor(electionId) })
    expect(response.status).toBe(409)
  })

  it('refuses a vote from a revoked voter', async () => {
    const user = await User.findOne({ email: 'voter@example.test' })
    await request(app).post(`/api/admin/voters/${String(user!._id)}/revoke`).set(auth(adminToken))

    const response = await request(app)
      .post('/api/votes')
      .set(auth(voterToken))
      .send({ electionId, ciphertext: ciphertextFor(electionId) })
    expect(response.status).toBe(403)
  })

  it('lists the voter’s own receipts', async () => {
    await request(app)
      .post('/api/votes')
      .set(auth(voterToken))
      .send({ electionId, ciphertext: ciphertextFor(electionId) })

    const response = await request(app).get('/api/votes/me').set(auth(voterToken))
    expect(response.status).toBe(200)
    expect(response.body.data).toHaveLength(1)
    expect(response.body.data[0].electionId).toBe(electionId)
  })
})

describe('results and trustees', () => {
  let adminToken: string
  let trusteeToken: string
  let electionId: number

  beforeEach(async () => {
    await createUser({ nid: '1995077788899', email: 'admin@example.test', roles: ['admin'] })
    await createUser({ nid: '1999012233445', email: 'candidate@example.test' })
    await createUser({
      nid: '1988061122334',
      email: 'trustee@example.test',
      roles: ['trustee'],
      walletAddress: TRUSTEE_ADDRESSES[0],
    })
    adminToken = await tokenFor('admin@example.test')
    trusteeToken = await tokenFor('trustee@example.test')
    const candidateToken = await tokenFor('candidate@example.test')
    electionId = await openElectionWithCandidates(adminToken, [{ token: candidateToken }])
  })

  it('409s results that have not been published', async () => {
    const response = await request(app).get(`/api/elections/${electionId}/results`)
    expect(response.status).toBe(409)
  })

  it('refuses to close an election before its end time', async () => {
    const response = await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'close' })
    expect(response.status).toBe(409)
  })

  it('tells a trustee to use their own client rather than sending a share to the server', async () => {
    const election = fakeChain.elections.get(electionId)!
    election.endTime = BigInt(Math.floor(Date.now() / 1000) - 1)
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'close' })

    const response = await request(app).post(`/api/trustee/elections/${electionId}/share`).set(auth(trusteeToken))

    // 428: the share must be computed and submitted by the trustee, with the trustee's key.
    expect(response.status).toBe(428)
    expect(response.body.message).toMatch(/never be sent to this server/i)
  })

  it('reports the encrypted tally to a trustee without decrypting anything', async () => {
    const response = await request(app).get(`/api/trustee/elections/${electionId}/tally`).set(auth(trusteeToken))
    expect(response.status).toBe(200)
    const tally = response.body.data as { ciphertext: string; ciphertextHash: string; publicKey: { n: string } }
    expect(tally.ciphertext).toMatch(/^0x[0-9a-f]+$/)
    expect(tally.ciphertextHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(Object.keys(tally)).not.toContain('totals')
  })

  it('refuses to publish a result below the trustee threshold', async () => {
    const election = fakeChain.elections.get(electionId)!
    election.endTime = BigInt(Math.floor(Date.now() / 1000) - 1)
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'close' })

    const response = await request(app).post(`/api/admin/elections/${electionId}/publish-result`).set(auth(adminToken))
    expect(response.status).toBe(409)
    expect(response.body.message).toMatch(/decryption shares/i)
  })

  it('refuses to publish while the election is still open', async () => {
    const response = await request(app).post(`/api/admin/elections/${electionId}/publish-result`).set(auth(adminToken))
    expect(response.status).toBe(409)
  })
})

describe('admin oversight', () => {
  let adminToken: string

  beforeEach(async () => {
    await createUser({ nid: '1995077788899', email: 'admin@example.test', roles: ['admin'] })
    await createUser({ nid: '2001045566778', email: 'voter@example.test' })
    adminToken = await tokenFor('admin@example.test')
  })

  it('reports statistics', async () => {
    const response = await request(app).get('/api/admin/stats').set(auth(adminToken))
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ totalVoters: 1, revokedVoters: 0, totalElections: 0 })
  })

  it('lists voters with masked National IDs only', async () => {
    const response = await request(app).get('/api/admin/voters').set(auth(adminToken))
    expect(response.status).toBe(200)
    const voters = response.body.data as { maskedNid: string }[]
    expect(voters).toHaveLength(1)
    expect(voters[0].maskedNid).toBe('•••• •••• 6778')
    expect(JSON.stringify(voters)).not.toContain('2001045566778')
  })

  it('revokes a voter on-chain and locally, and refuses a second revocation', async () => {
    const user = await User.findOne({ email: 'voter@example.test' })
    const response = await request(app).post(`/api/admin/voters/${String(user!._id)}/revoke`).set(auth(adminToken))

    expect(response.status).toBe(200)
    expect(response.body.data.revoked).toBe(true)
    expect(fakeChain.voters.get(user!.voterCommitment)!.revoked).toBe(true)

    const again = await request(app).post(`/api/admin/voters/${String(user!._id)}/revoke`).set(auth(adminToken))
    expect(again.status).toBe(409)
  })

  it('404s an unknown voter id', async () => {
    const response = await request(app)
      .post('/api/admin/voters/5f2b1c1e1c9d440000000000/revoke')
      .set(auth(adminToken))
    expect(response.status).toBe(404)
  })
})

describe('candidate self-service', () => {
  it('returns only the signed-in user’s candidacies', async () => {
    await createUser({ nid: '1995077788899', email: 'admin@example.test', roles: ['admin'] })
    await createUser({ nid: '2001045566778', email: 'voter@example.test' })
    const adminToken = await tokenFor('admin@example.test')
    const voterToken = await tokenFor('voter@example.test')

    const created = await createElection(adminToken)
    const electionId = (created.body.data as { id: number }).id
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-candidate-registration' })
    await request(app)
      .post(`/api/elections/${electionId}/candidates`)
      .set(auth(voterToken))
      .send({ electionId, party: 'X', manifesto: 'A platform of at least ten characters.' })

    const mine = await request(app).get('/api/candidates/me').set(auth(voterToken))
    expect(mine.status).toBe(200)
    expect(mine.body.data).toHaveLength(1)

    const adminsOwn = await request(app).get('/api/candidates/me').set(auth(adminToken))
    expect(adminsOwn.body.data).toHaveLength(0)

    expect(await Candidate.countDocuments({})).toBe(1)
  })
})

describe('Upazila scoping', () => {
  let adminToken: string
  let localToken: string
  let outsiderToken: string
  let electionId: number

  beforeEach(async () => {
    await createUser({ nid: '1995077788899', email: 'admin@example.test', roles: ['admin'] })
    await createUser({ nid: '2001045566778', email: 'local@example.test', upazilaId: UPAZILA_A })
    await createUser({ nid: '1988061122334', email: 'outsider@example.test', upazilaId: UPAZILA_B })
    adminToken = await tokenFor('admin@example.test')
    localToken = await tokenFor('local@example.test')
    outsiderToken = await tokenFor('outsider@example.test')

    const created = await createElection(adminToken, { upazilaId: UPAZILA_A })
    expect(created.status).toBe(201)
    electionId = (created.body.data as { id: number }).id
  })

  it('records the area on the election and reports its name', async () => {
    const detail = await request(app).get(`/api/elections/${electionId}`)
    expect(detail.body.data.upazilaId).toBe(UPAZILA_A)
    // The name comes from the catalogue, so the UI never has to show a bare code.
    expect(detail.body.data.upazilaName).toBeTypeOf('string')
  })

  it('refuses an election in an unregistered area', async () => {
    const response = await createElection(adminToken, { upazilaId: 999 })
    expect(response.status).toBe(422)
  })

  it('reports a voter from another Upazila as ineligible, naming both areas', async () => {
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-candidate-registration' })

    const eligibility = await request(app)
      .get(`/api/elections/${electionId}/eligibility`)
      .set(auth(outsiderToken))

    expect(eligibility.status).toBe(200)
    expect(eligibility.body.data).toMatchObject({ eligible: false, reason: 'wrong-area' })
    expect(eligibility.body.data.electionUpazilaName).toBeTruthy()
    expect(eligibility.body.data.voterUpazilaName).toBeTruthy()
  })

  it('refuses a candidate application from another Upazila', async () => {
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-candidate-registration' })

    const outsider = await request(app)
      .post(`/api/elections/${electionId}/candidates`)
      .set(auth(outsiderToken))
      .send({ electionId, party: 'Elsewhere', manifesto: 'A platform of at least ten characters.' })
    expect(outsider.status).toBe(403)

    const local = await request(app)
      .post(`/api/elections/${electionId}/candidates`)
      .set(auth(localToken))
      .send({ electionId, party: 'Local', manifesto: 'A platform of at least ten characters.' })
    expect(local.status).toBe(201)
  })

  it('refuses a ballot from another Upazila and accepts one from inside it', async () => {
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-candidate-registration' })
    const application = await request(app)
      .post(`/api/elections/${electionId}/candidates`)
      .set(auth(localToken))
      .send({ electionId, party: 'Local', manifesto: 'A platform of at least ten characters.' })
    await request(app)
      .patch(`/api/admin/candidates/${(application.body.data as { id: number }).id}`)
      .set(auth(adminToken))
      .send({ electionId, status: CandidateStatus.Approved })
    await request(app)
      .post(`/api/elections/${electionId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-voting' })
    fakeChain.elections.get(electionId)!.startTime = BigInt(Math.floor(Date.now() / 1000) - 60)

    const outsiderVote = await request(app)
      .post('/api/votes')
      .set(auth(outsiderToken))
      .send({ electionId, ciphertext: ciphertextFor(electionId) })
    expect(outsiderVote.status).toBe(403)
    expect(outsiderVote.body.message).toMatch(/Upazila/i)

    const localVote = await request(app)
      .post('/api/votes')
      .set(auth(localToken))
      .send({ electionId, ciphertext: ciphertextFor(electionId) })
    expect(localVote.status).toBe(201)
  })

  it('lets a national election admit every area', async () => {
    const created = await createElection(adminToken, { upazilaId: 0, name: 'National Election' })
    const nationalId = (created.body.data as { id: number }).id
    await request(app)
      .post(`/api/elections/${nationalId}/transition`)
      .set(auth(adminToken))
      .send({ transition: 'open-candidate-registration' })

    for (const token of [localToken, outsiderToken]) {
      const application = await request(app)
        .post(`/api/elections/${nationalId}/candidates`)
        .set(auth(token))
        .send({ electionId: nationalId, party: 'Any', manifesto: 'A platform of at least ten characters.' })
      expect(application.status).toBe(201)
    }
  })

  it('publishes the Upazila catalogue and registers a new area', async () => {
    const before = await request(app).get('/api/upazilas')
    expect(before.status).toBe(200)

    const created = await request(app)
      .post('/api/admin/upazilas')
      .set(auth(adminToken))
      .send({ upazilaId: 303, name: 'Nabagram Test Upazila', district: 'Test District' })
    expect(created.status).toBe(201)

    const duplicate = await request(app)
      .post('/api/admin/upazilas')
      .set(auth(adminToken))
      .send({ upazilaId: 303, name: 'Again' })
    expect(duplicate.status).toBe(409)

    const asVoter = await request(app)
      .post('/api/admin/upazilas')
      .set(auth(localToken))
      .send({ upazilaId: 404, name: 'Rogue' })
    expect(asVoter.status).toBe(403)
  })
})

describe('area transfer', () => {
  let adminToken: string
  let voterToken: string

  beforeEach(async () => {
    await createUser({ nid: '1995077788899', email: 'admin@example.test', roles: ['admin'] })
    await createUser({ nid: '2001045566778', email: 'voter@example.test', upazilaId: UPAZILA_A })
    adminToken = await tokenFor('admin@example.test')
    voterToken = await tokenFor('voter@example.test')
  })

  const fileRequest = (token: string, toUpazilaId = UPAZILA_B) =>
    request(app)
      .post('/api/transfers')
      .set(auth(token))
      .send({ toUpazilaId, evidence: 'Utility bill for the new address, reference 12345.' })

  it('accepts a request, approves it, and moves the voter on-chain', async () => {
    const filed = await fileRequest(voterToken)
    expect(filed.status).toBe(201)
    expect(filed.body.data).toMatchObject({ status: 'pending', fromUpazilaId: UPAZILA_A, toUpazilaId: UPAZILA_B })

    const pending = await request(app).get('/api/admin/transfers').set(auth(adminToken))
    expect(pending.body.data).toHaveLength(1)

    const decided = await request(app)
      .post(`/api/admin/transfers/${(filed.body.data as { id: string }).id}/decide`)
      .set(auth(adminToken))
      .send({ approve: true })

    expect(decided.status).toBe(200)
    expect(decided.body.data.status).toBe('approved')
    expect(decided.body.data.txHash).toMatch(/^0x[0-9a-f]{64}$/)

    // One area at a time: the chain now holds the new tag, not both.
    const user = await User.findOne({ email: 'voter@example.test' })
    expect(fakeChain.voters.get(user!.voterCommitment)!.upazilaId).toBe(UPAZILA_B)
    expect(user!.upazilaId).toBe(UPAZILA_B)
  })

  it('rejects a request with a reason, leaving the area unchanged', async () => {
    const filed = await fileRequest(voterToken)
    const decided = await request(app)
      .post(`/api/admin/transfers/${(filed.body.data as { id: string }).id}/decide`)
      .set(auth(adminToken))
      .send({ approve: false, reason: 'The evidence does not show the new address.' })

    expect(decided.status).toBe(200)
    expect(decided.body.data.status).toBe('rejected')
    const user = await User.findOne({ email: 'voter@example.test' })
    expect(user!.upazilaId).toBe(UPAZILA_A)
  })

  it('requires a reason to reject, and refuses a second decision', async () => {
    const filed = await fileRequest(voterToken)
    const id = (filed.body.data as { id: string }).id

    const noReason = await request(app)
      .post(`/api/admin/transfers/${id}/decide`)
      .set(auth(adminToken))
      .send({ approve: false })
    expect(noReason.status).toBe(400)

    await request(app).post(`/api/admin/transfers/${id}/decide`).set(auth(adminToken)).send({ approve: true })
    const again = await request(app)
      .post(`/api/admin/transfers/${id}/decide`)
      .set(auth(adminToken))
      .send({ approve: true })
    expect(again.status).toBe(409)
  })

  it('refuses a duplicate request, a move to the same area, and an unknown area', async () => {
    await fileRequest(voterToken)
    expect((await fileRequest(voterToken)).status).toBe(409)

    const sameArea = await fileRequest(voterToken, UPAZILA_A)
    expect(sameArea.status).toBe(409)

    const unknown = await fileRequest(voterToken, 999)
    expect(unknown.status).toBe(422)
  })

  it('closes transfers once an election the voter could take part in is under way', async () => {
    // Candidate registration has closed for an election in the voter's area …
    const created = await createElection(adminToken, { upazilaId: UPAZILA_A })
    const electionId = (created.body.data as { id: number }).id
    fakeChain.elections.get(electionId)!.candidateRegistrationEnd = BigInt(Math.floor(Date.now() / 1000) - 60)

    const filed = await fileRequest(voterToken)
    expect(filed.status).toBe(409)
    expect(filed.body.message).toMatch(/in progress/i)
  })

  it('keeps a voter’s requests private and the queue admin-only', async () => {
    await fileRequest(voterToken)
    const mine = await request(app).get('/api/transfers/me').set(auth(voterToken))
    expect(mine.body.data).toHaveLength(1)

    expect((await request(app).get('/api/admin/transfers').set(auth(voterToken))).status).toBe(403)
    expect((await request(app).get('/api/transfers/me')).status).toBe(401)
  })
})

describe('disputes', () => {
  let adminToken: string
  let voterToken: string

  beforeEach(async () => {
    await createUser({ nid: '1995077788899', email: 'admin@example.test', roles: ['admin'] })
    await createUser({ nid: '2001045566778', email: 'voter@example.test', upazilaId: UPAZILA_A })
    adminToken = await tokenFor('admin@example.test')
    voterToken = await tokenFor('voter@example.test')
  })

  const raise = (token: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post('/api/disputes')
      .set(auth(token))
      .send({ category: 'wrong-area', detail: 'My record shows the wrong Upazila entirely.', ...body })

  it('suspends the voter on-chain while the dispute is open', async () => {
    const raised = await raise(voterToken)
    expect(raised.status).toBe(201)
    expect(raised.body.data.status).toBe('open')
    expect(raised.body.data.holdTxHash).toMatch(/^0x[0-9a-f]{64}$/)

    const user = await User.findOne({ email: 'voter@example.test' })
    expect(user!.onHold).toBe(true)
    expect(fakeChain.voters.get(user!.voterCommitment)!.onHold).toBe(true)
    // The on-chain registration check now refuses them, which is what blocks a ballot.
    expect(fakeChain.isRegisteredVoter(user!.voterCommitment)).toBe(false)
  })

  it('reports an on-hold voter as ineligible rather than unregistered', async () => {
    const created = await createElection(adminToken, { upazilaId: UPAZILA_A })
    const electionId = (created.body.data as { id: number }).id
    await raise(voterToken)

    const eligibility = await request(app)
      .get(`/api/elections/${electionId}/eligibility`)
      .set(auth(voterToken))
    expect(eligibility.body.data.reason).toBe('account-on-hold')
  })

  it('resolves a dispute, corrects the area, and restores eligibility', async () => {
    const raised = await raise(voterToken)
    const resolved = await request(app)
      .post(`/api/admin/disputes/${(raised.body.data as { id: string }).id}/resolve`)
      .set(auth(adminToken))
      .send({
        outcome: 'upheld',
        resolution: 'Registry address confirmed; area corrected.',
        correctedUpazilaId: UPAZILA_B,
      })

    expect(resolved.status).toBe(200)
    expect(resolved.body.data.status).toBe('upheld')

    const user = await User.findOne({ email: 'voter@example.test' })
    expect(user!.onHold).toBe(false)
    expect(user!.upazilaId).toBe(UPAZILA_B)
    expect(fakeChain.voters.get(user!.voterCommitment)!.onHold).toBe(false)
    expect(fakeChain.voters.get(user!.voterCommitment)!.upazilaId).toBe(UPAZILA_B)
  })

  it('rejects a dispute without changing the record', async () => {
    const raised = await raise(voterToken)
    const resolved = await request(app)
      .post(`/api/admin/disputes/${(raised.body.data as { id: string }).id}/resolve`)
      .set(auth(adminToken))
      .send({ outcome: 'rejected', resolution: 'The registry record is correct.' })

    expect(resolved.body.data.status).toBe('rejected')
    const user = await User.findOne({ email: 'voter@example.test' })
    expect(user!.onHold).toBe(false)
    expect(user!.upazilaId).toBe(UPAZILA_A)
  })

  it('refuses a second open dispute and a resolution of a closed one', async () => {
    const raised = await raise(voterToken)
    expect((await raise(voterToken)).status).toBe(409)

    const id = (raised.body.data as { id: string }).id
    await request(app)
      .post(`/api/admin/disputes/${id}/resolve`)
      .set(auth(adminToken))
      .send({ outcome: 'rejected', resolution: 'Record is correct.' })

    const again = await request(app)
      .post(`/api/admin/disputes/${id}/resolve`)
      .set(auth(adminToken))
      .send({ outcome: 'rejected', resolution: 'Again.' })
    expect(again.status).toBe(409)
  })

  it('keeps the queue admin-only and a voter’s own disputes private', async () => {
    await raise(voterToken)
    expect((await request(app).get('/api/disputes/me').set(auth(voterToken))).body.data).toHaveLength(1)
    expect((await request(app).get('/api/admin/disputes').set(auth(voterToken))).status).toBe(403)
    expect((await request(app).get('/api/admin/disputes').set(auth(adminToken))).body.data).toHaveLength(1)
  })
})
