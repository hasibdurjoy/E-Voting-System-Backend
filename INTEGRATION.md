# Integration Guide — Backend

**Audience:** whoever works on the backend.
**Status:** ✅ **Implemented.** 85 tests passing, every endpoint live, no route returns `501`.

This document was the build spec and is now the reference for what was built. Where the
implementation made a decision the spec left open, the decision is recorded here in place of the
question — see §11 (Trustee) and the notes below.

**What changed from the spec as written:**

| Spec said | What was built | Why |
| --- | --- | --- |
| `multer` for selfie uploads | A dedicated 8 MB JSON parser on the two routes that carry a selfie | The frontend sends a base64 data URL in JSON, not multipart; raising the global 100 kB cap would have handed every other route an 8 MB surface |
| Trustee endpoint "decide before implementing" | Option A — trustee-side, enforced by **428** | The contract requires `msg.sender` to be a trustee, so the relayer *cannot* submit a share for anyone |
| Server-clock window checks | Chain-clock window checks (`blockchain/time.ts`) | The contract judges windows by `block.timestamp`; comparing against the server clock reports voters eligible for ballots the chain is about to reject |
| — | `TRUSTEE_ADDRESSES`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `CONFIRMATIONS`, `RELAYER_MIN_BALANCE_ETH` | The committee has to come from somewhere, and limits belong in configuration rather than in source |

**Read first:**
- [`../e-voting-system-smart-contracts/INTEGRATION.md`](../e-voting-system-smart-contracts/INTEGRATION.md) — contract reference, encoding rules, error mapping
- [`../e-voting-system-frontend/src/services/backend.contract.ts`](../e-voting-system-frontend/src/services/backend.contract.ts) — **the API contract, in TypeScript**
- [`../WORKFLOW.md`](../WORKFLOW.md) — the end-to-end workflow

---

## 1. What already exists

Do not rebuild these:

| Already in place | File |
| --- | --- |
| Express app factory, security middleware, rate limiting | `src/app.ts`, `src/middleware/security.ts` |
| Zod-validated environment loading | `src/config/env.ts` |
| Mongoose connection with redacted-URI errors | `src/config/database.ts` |
| Central error handler + `ApiError` | `src/middleware/errorHandler.ts`, `src/utils/ApiError.ts` |
| Request validation middleware | `src/middleware/validate.ts` |
| Secret-safe logger | `src/utils/logger.ts` |
| Provider / wallet / contract wiring | `src/blockchain/` |
| Generated contract ABI + sync script | `src/blockchain/abi/`, `scripts/sync-contracts.mjs` |
| Route skeleton mounted under `/api` | `src/routes/` |

`ApiError` now has `badRequest`, `unauthorized(401)`, `forbidden(403)`, `notFound(404)`,
`conflict(409)`, `gone(410)`, `unprocessable(422)`, `preconditionRequired(428)`,
`tooManyRequests(429)`, `internal(500)`, `notImplemented(501)` and `serviceUnavailable(503)`.
The frontend distinguishes UI states by status code — `409` in particular drives the
"already registered" and "already voted" screens.

---

## 2. Build order

Each step is independently testable. Do not start the next until the current one has tests.

| # | Step | Depends on |
| --- | --- | --- |
| 1 | Dependencies + env schema | — |
| 2 | Mongoose models | 1 |
| 3 | Crypto module (Paillier + threshold) | 1 |
| 4 | NID + face adapters (mock) | 1 |
| 5 | Auth (register, login, JWT, guards) | 2, 4 |
| 6 | Relayer service | 2 |
| 7 | Elections + candidates | 5, 6 |
| 8 | Voting + eligibility | 7 |
| 9 | Trustee + decryption + results | 3, 7 |
| 10 | Event listener + reconciliation | 6 |
| 11 | Audit log | 5 |
| 12 | End-to-end test across all three repos | all |

---

## 3. Dependencies to add

```bash
yarn add jsonwebtoken argon2 multer
yarn add -D @types/jsonwebtoken @types/multer
```

| Package | Why |
| --- | --- |
| `jsonwebtoken` | Session tokens |
| `argon2` | Password hashing — **use Argon2id, not bcrypt** |
| `multer` | Selfie upload; `express.json` is capped at 100 kB |

**No new cryptography library.** Paillier is implemented over native `BigInt` in `src/crypto/`
(§6), matching the frontend's `src/lib/paillier.ts` byte-for-byte on the wire.

---

## 4. Environment variables

Extend the Zod schema in `src/config/env.ts`. Never log a value.

```env
# ── existing ────────────────────────────────────────
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/e_voting_system
CORS_ORIGIN=http://localhost:5173
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
CONTRACT_ADDRESS=
BACKEND_PRIVATE_KEY=                 # SECRET — must hold RELAYER_ROLE

# ── auth ────────────────────────────────────────────
JWT_SECRET=                          # SECRET — min 32 bytes of entropy
JWT_EXPIRES_IN=24h
FACIAL_VERIFICATION_MODE=registration_only   # | login_and_registration
MINIMUM_VOTING_AGE=18

# ── identity providers ──────────────────────────────
NID_PROVIDER=mock                    # | production adapter name
NID_PROVIDER_URL=
NID_PROVIDER_KEY=                    # SECRET
FACE_PROVIDER=mock
FACE_PROVIDER_URL=
FACE_PROVIDER_KEY=                   # SECRET
FACE_MATCH_THRESHOLD=0.85
FACE_LIVENESS_REQUIRED=true

# ── identity cryptography ───────────────────────────
NID_HMAC_PEPPER=                     # SECRET — see §5.1, this one matters a lot
PII_ENCRYPTION_KEY=                  # SECRET — 32 bytes, AES-256-GCM at rest

# ── election cryptography ───────────────────────────
PAILLIER_KEY_BITS=2048
BALLOT_BASE_BITS=32
```

Validation rules worth enforcing at startup: `JWT_SECRET` length ≥ 32; `NID_HMAC_PEPPER` and
`PII_ENCRYPTION_KEY` present whenever `NODE_ENV=production`; `PAILLIER_KEY_BITS` a multiple of 256
(the contract requires `len(n) % 32 == 0` bytes).

---

## 5. Data models

`src/models/`. **Off-chain holds identity; on-chain holds commitments and state.**

### 5.1 `User` — and the two NID derivations

This is the subtlest part of the design. A Bangladeshi NID is ~13 digits: roughly 10¹³
possibilities, which is **trivially brute-forceable**. A naive `keccak256(nid)` stored anywhere —
especially on a public chain — can be reversed by exhaustive search in seconds.

Two *different* derivations are therefore required, for two different jobs:

```ts
// (a) Duplicate detection — needs to be deterministic across users, so it must be
//     keyed with a SERVER-HELD SECRET that never leaves the backend.
nidLookupHash = HMAC-SHA256(NID_HMAC_PEPPER, normalisedNid)     // unique index, never on-chain

// (b) On-chain identity — needs to be unlinkable even to someone holding the whole
//     database dump, so it is salted PER VOTER with fresh randomness.
commitmentSalt  = randomBytes(32)                                // stored encrypted, per user
voterCommitment = keccak256(normalisedNid ‖ commitmentSalt)      // this is what goes on-chain
```

Using (b) for duplicate detection is impossible — you cannot recompute it from the NID alone.
Using (a) on-chain would leak every NID the moment the pepper leaked. **You need both.**

```ts
{
  _id, fullName,
  nidEncrypted: Buffer,        // AES-256-GCM under PII_ENCRYPTION_KEY
  nidLookupHash: String,       // unique index — duplicate detection
  commitmentSalt: Buffer,      // encrypted at rest
  voterCommitment: String,     // 0x-prefixed 32 bytes, unique index — the on-chain id
  dateOfBirth: Date,
  email: String,               // unique, lowercased
  phone: String,
  passwordHash: String,        // Argon2id
  roles: [String],             // 'voter' | 'admin' | 'trustee'
  faceEmbedding: Buffer,       // encrypted; NEVER the source image
  revoked: Boolean,
  registeredAt: Date,
  registrationTxHash: String,
}
```

Indexes: `nidLookupHash` unique, `voterCommitment` unique, `email` unique.

**Never** add a plaintext `nid` field, even temporarily. **Never** persist the selfie image.

### 5.2 `RegistrationSession`

Holds the half-finished registration between the three steps. TTL-expired.

```ts
{
  token: String,               // unique — the `registrationToken` the frontend carries
  nidEncrypted, nidLookupHash, fullName, dateOfBirth,
  nidVerified: Boolean, faceVerified: Boolean,
  faceMatchScore: Number, livenessPassed: Boolean,
  createdAt: Date,             // TTL index, expires after 15 minutes
}
```

Expiry must produce `410 Gone`, which the frontend renders as "your session expired, start again".

### 5.3 `Election`

A **cache** of chain state plus the off-chain-only fields. The chain is authoritative.

```ts
{
  chainElectionId: Number,     // unique — the contract's 1-based id
  name, description,
  candidateRegistrationEnd: Date, startTime: Date, endTime: Date,
  status: Number,              // mirrors ElectionStatus; refreshed from chain
  publicKeyN: String, publicKeyNSquared: String,   // 0x hex
  privateKeyRef: String,       // reference to key custody, NEVER the key itself
  trusteeThreshold: Number, trusteeCount: Number,
  createdBy: ObjectId,
  txHashes: { created, keyed, trusteesSet, opened, votingOpened, closed, published },
}
```

### 5.4 `Candidate`

```ts
{
  electionId: ObjectId, chainElectionId: Number,
  chainCandidateId: Number,    // uint32 from registerCandidate()
  userId: ObjectId,
  party: String,               // null = independent
  manifesto: String, photoUrl: String,
  profileHash: String,         // keccak256 of the canonical profile
  ballotIndex: Number,         // null until approved — READ IT FROM THE CHAIN
  status: Number,              // mirrors CandidateStatus
  rejectionReason: String,
  submittedAt: Date, decidedAt: Date,
}
```

Unique compound index on `(electionId, userId)`.

> `profileHash` must be computed from a **canonical serialisation** (fixed field order, trimmed,
> NFC-normalised). Otherwise the anchor cannot be re-verified later.

### 5.5 `Trustee`

```ts
{
  userId: ObjectId, electionId: ObjectId,
  address: String,             // their signing address, holds TRUSTEE_ROLE
  verificationKey: String,     // v_i — public, used to verify partial decryptions
  shareDelivered: Boolean,     // the SHARE ITSELF IS NOT STORED HERE
  shareSubmittedAt: Date, shareTxHash: String,
}
```

**The backend must never persist a trustee's key share.** It generates the shares, delivers each to
its trustee over a secure channel, and forgets them. Storing them would defeat the entire scheme.

### 5.6 `VoteReceipt`

```ts
{
  electionId: ObjectId, chainElectionId: Number,
  userId: ObjectId,            // see the privacy note below
  receiptCode: String,         // short, human-checkable
  txHash: String, blockNumber: Number,
  ciphertextHash: String,      // keccak256 of the submitted ciphertext
  castAt: Date, confirmed: Boolean,
}
```

Unique compound index on `(electionId, userId)` — a database-level backstop behind the contract's
`hasVoted`.

> **Privacy note.** This row links a voter to a *transaction*, which is unavoidable if voters are to
> receive receipts and the server is to prevent double voting. It must never store the ciphertext
> itself or anything derived from the choice. `ciphertextHash` is safe because the ciphertext is
> randomised — the same vote encrypts differently every time.

### 5.7 `DecryptionSession`, `VerificationRecord`, `AuditLog`

```ts
DecryptionSession { electionId, threshold, sharesSubmitted, shares: [{trusteeId, txHash, submittedAt}],
                    combinedAt, totals: [Number], publishTxHash }

VerificationRecord { userId, type: 'nid'|'face', provider, outcome, matchScore,
                     livenessPassed, createdAt }        // NO raw NID, NO image

AuditLog { actor, actorRole, action, targetType, targetId, outcome,
           ipHash, userAgent, txHash, createdAt }        // ipHash, not raw IP
```

---

## 6. Crypto module — `src/crypto/`

### 6.1 `paillier.ts` — must match the frontend exactly

The frontend encrypts; the backend only needs keygen and the threshold operations. The wire format
is fixed by the contract: **big-endian hex, zero-padded to `len(n²)`**.

```
Keygen:     p, q safe primes of PAILLIER_KEY_BITS/2;  n = pq;  g = n + 1
Encrypt:    E(m, r) = (1 + m·n) · rⁿ mod n²        (frontend does this)
Aggregate:  ∏ cᵢ mod n²                             (the CONTRACT does this)
```

`PAILLIER_KEY_BITS=2048` → `n` is 256 bytes, `n²` is 512 bytes. Both satisfy the contract's
"multiple of 32" rule. **Left-pad every value to full width before hex-encoding.**

### 6.2 `threshold.ts` — Damgård–Jurik threshold decryption

This is the largest single piece of work and the one place where a mistake is silent. Implement the
published scheme; do not improvise.

> **References:** Damgård & Jurik, *A Generalisation, a Simplification and Some Applications of
> Paillier's Probabilistic Public-Key System* (PKC 2001); Fouque, Poupard & Stern,
> *Sharing Decryption in the Context of Voting or Lotteries* (FC 2000).

**Setup** (run once per election, before `setElectionKey`):

```
p = 2p' + 1, q = 2q' + 1     safe primes
n = pq,  m = p'q'
β ← random in Z*n
d  such that  d ≡ 0 (mod m)  and  d ≡ 1 (mod n)      (CRT)  — d = β·m·(βm)⁻¹ᴺ form
Shamir-share d over Z_{nm}:  f(X) = d + a₁X + … + a_{k-1}X^{k-1},  sᵢ = f(i)
Δ = l!                        (l = number of trustees)
verification keys: v, vᵢ = v^{Δ·sᵢ} mod n²
```

**Partial decryption** (each trustee, on the aggregate `c`):

```
cᵢ = c^{2·Δ·sᵢ} mod n²
```

Serialise `cᵢ` big-endian, padded to `len(n²)`, and submit as the `share` bytes.

**Combination** (needs any `k` shares, subset `S`):

```
μᵢ = Δ · ∏_{j∈S\{i}} (−j)/(i−j)          integer Lagrange coefficients
c' = ∏_{i∈S} cᵢ^{2μᵢ} mod n²  =  c^{4Δ²d} mod n²
M  = L(c') · (4Δ²β·m)⁻¹ mod n            where L(x) = (x−1)/n
```

**Unpacking** — `M` is the base-`B` packed total:

```ts
const B = 2n ** BigInt(BALLOT_BASE_BITS)
const totals = []
let rest = M
for (let i = 0; i < approvedCandidateCount; i++) { totals.push(Number(rest % B)); rest /= B }
```

**Test it hard.** At minimum: round-trip a known tally end-to-end; verify any `k`-subset of shares
produces the same result; verify `k−1` shares produce garbage; verify totals unpack correctly when
one candidate has zero votes and when another is near `2³²`.

> **Do not** implement the simpler "Shamir-share the private key and reconstruct it at combine
> time" shortcut. It looks equivalent and is not: reconstruction means one machine holds the whole
> key, which is precisely what the trustee model exists to prevent. The contract's refusal of
> `threshold < 2` assumes real threshold decryption.

### 6.3 `commitment.ts`

```ts
normaliseNid(nid)         // trim, strip separators, validate shape
nidLookupHash(nid)        // HMAC-SHA256 under NID_HMAC_PEPPER
voterCommitment(nid, salt)// keccak256(nid ‖ salt) → 0x-prefixed 32 bytes
profileHash(profile)      // keccak256 of the canonical candidate serialisation
```

---

## 7. Identity adapters — `src/providers/`

Both are behind an interface so the mock can be swapped for a real provider by changing one env var.

```ts
export interface NidProvider {
  lookup(nid: string): Promise<{
    found: boolean
    fullName?: string
    dateOfBirth?: string   // ISO date
    isCitizen?: boolean
  }>
}

export interface FaceProvider {
  verify(input: { selfieImage: Buffer; referencePhoto?: Buffer; embedding?: Buffer }): Promise<{
    matchScore: number     // 0–1
    livenessPassed: boolean
    embedding: Buffer      // store this, never the image
  }>
}
```

**`MockNidProvider`** — a small fixture set. The proposal (§6) notes that access to the real
national database requires extensive permissions, so the mock is the expected state for this project.
It must **never contain real citizen data**; use obviously synthetic records. The frontend's demo
registration page already lists the fixtures it expects:

The canonical fixture list — 10 registerable records plus the deliberate failure cases — is
[`../e-voting-system-frontend/TEST-ACCOUNTS.md`](../e-voting-system-frontend/TEST-ACCOUNTS.md),
generated from `mock.data.ts`. **Mirror it exactly**, so the same National ID behaves identically
whether the frontend is running against the mock or against you. Each record must reproduce its
status code: `404` unknown, `422` mismatch or under age, `409` already registered.

**`MockFaceProvider`** — returns a configurable score, fails on implausibly small payloads, and
simulates a liveness check. **To replace in production:** swap for a real provider, keep the
interface, and confirm the provider is contractually bound not to retain images.

Document the swap in the module header. Do not let the mock be selectable in production — validate
`NID_PROVIDER !== 'mock'` when `NODE_ENV=production`, or fail startup.

---

## 8. Auth

- **Hashing:** Argon2id, default params or stronger. Never bcrypt, never a bare SHA.
- **Tokens:** JWT signed with `JWT_SECRET`, carrying `{ sub, roles, iat, exp }` and nothing sensitive.
- **Guards:** `requireAuth`, `requireRole('admin' | 'trustee')`. Re-read the user from the database
  on every request — a JWT issued before a revocation must not keep working.
- **Uniform failures:** wrong password and unknown account return the **same** `401` with the same
  message. Leaking which accounts exist is an enumeration oracle over NIDs.
- **Rate limits:** the global 100/15 min limiter is far too loose for auth. Add per-route limits —
  roughly 5/15 min on login and on `verify-nid`, keyed by IP **and** by identifier.
- **`FACIAL_VERIFICATION_MODE`:** when `login_and_registration`, `POST /auth/login` requires
  `selfieImage` and must reject without it. `GET /auth/config` tells the frontend which mode is
  active so it can show or hide the camera step.

---

## 9. Relayer — `src/services/relayer.service.ts`

All writes go through the backend signer, which holds `RELAYER_ROLE`.

- **Serialise transactions.** Concurrent sends from one signer collide on nonces. Use a queue (or an
  explicit nonce manager) so only one transaction is in flight at a time.
- **Wait for confirmation** before reporting success. The frontend's `VoteReceipt.confirmed` drives
  whether it shows "confirmed" or "pending".
- **Decode custom errors** via the JSON ABI and map them to HTTP status per
  [the contract error table](../e-voting-system-smart-contracts/INTEGRATION.md#6-custom-errors--http-status).
- **Never retry a vote automatically.** If `castVote` reverts with `AlreadyVoted`, that is terminal.
- **Monitor the signer's balance.** A relayer that runs out of gas halts the entire election; log a
  warning below a configurable threshold.

---

## 10. Event listener — `src/services/events.service.ts`

Subscribe to the contract and reconcile the Mongo cache. The chain is authoritative.

| Event | Reconciles |
| --- | --- |
| `VoterRegistered` / `VoterRevoked` | `User.registrationTxHash`, `User.revoked` |
| `ElectionCreated` / `ElectionStatusChanged` | `Election.chainElectionId`, `Election.status` |
| `ElectionKeyConfigured` / `ElectionTrusteesConfigured` | key + trustee cache |
| `CandidateRegistered` / `CandidateStatusChanged` | `chainCandidateId`, `status`, **`ballotIndex`** |
| `VoteCast` | `VoteReceipt.confirmed`, `blockNumber` |
| `ElectionClosed` | cached tally hash |
| `DecryptionShareSubmitted` | `DecryptionSession.sharesSubmitted` |
| `ResultPublished` | `DecryptionSession.totals`, `publishTxHash` |

Persist the last processed block and replay from it on restart, so events are not missed during
downtime. Handle reorgs by requiring N confirmations before treating a receipt as final.

---

## 11. API reference

Every response uses the existing envelope: `{ success: true, data }` or
`{ success: false, message, errors? }`. Field names below are **exact** — the frontend consumes them
verbatim. The authoritative definition is
[`backend.contract.ts`](../e-voting-system-frontend/src/services/backend.contract.ts).

### Auth

| Method | Path | Auth | Request → Response |
| --- | --- | --- | --- |
| GET | `/api/auth/config` | — | → `{ facialVerificationMode, minimumVotingAge }` |
| POST | `/api/auth/register/verify-nid` | — | `{ fullName, nid, dateOfBirth }` → `{ verified, maskedNid, registrationToken, ageVerified, citizenshipVerified }` |
| POST | `/api/auth/register/verify-face` | — | `{ registrationToken, selfieImage }` → `{ verified, matchScore, livenessPassed }` |
| POST | `/api/auth/register/complete` | — | `{ registrationToken, email, phone, password }` → `{ token, user, expiresAt }` |
| POST | `/api/auth/login` | — | `{ identifier, password, selfieImage? }` → `{ token, user, expiresAt }` |
| GET | `/api/auth/me` | voter | → `User` |
| POST | `/api/auth/logout` | voter | → `null` |

`verify-nid` status codes, each driving a distinct screen:
`404` NID not in registry · `422` name/DOB mismatch, or under age ·
**`409` already registered** · `429` rate limited.

`maskedNid` format: `"•••• •••• 4821"` — last four digits only.

### Elections

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/api/elections` | — | `Election[]` |
| GET | `/api/elections/:id` | — | `ElectionDetail` (= `Election` + `candidates[]` + `publicKey`) |
| GET | `/api/elections/:id/eligibility` | optional | `EligibilityResult` |
| GET | `/api/elections/:id/results` | — | `ElectionResult` — `409` if not published |
| POST | `/api/elections` | **admin** | `CreateElectionInput` → `Election` |
| POST | `/api/elections/:id/transition` | **admin** | `{ transition }` → `Election` |

`transition` ∈ `'open-candidate-registration' | 'open-voting' | 'close'`.

**`ElectionDetail.candidates` must contain only `Approved` candidates once status ≥ `Voting`(2).**
Before that, all applications may be shown. This is what "only approved candidates appear on the
ballot" means at the API layer.

**`publicKey`** is `{ n, nSquared, ballotBase }` — hex, hex, decimal string — or `null` while the
election is still `Draft`. The frontend cannot encrypt without it.

**Dates are ISO 8601 strings** in JSON, converted to `uint64` seconds only at the contract boundary.

`EligibilityResult.reason` ∈ `'not-authenticated' | 'not-registered' | 'account-revoked' |
'election-not-open' | 'already-voted'` — or `null` when eligible. Each maps to its own UI message,
so return the accurate one.

### Candidates

| Method | Path | Auth | Request → Response |
| --- | --- | --- | --- |
| POST | `/api/elections/:id/candidates` | voter | `{ electionId, party, manifesto, photoUrl? }` → `Candidate` |
| GET | `/api/candidates/me` | voter | → `Candidate[]` |
| PATCH | `/api/admin/candidates/:id` | **admin** | `{ electionId, status, reason? }` → `Candidate` |

`status` is the numeric enum: `2` Approved, `3` Rejected. `reason` is required for rejection and is
shown to the applicant.

### Voting

| Method | Path | Auth | Request → Response |
| --- | --- | --- | --- |
| POST | `/api/votes` | voter | `{ electionId, ciphertext }` → `VoteReceipt` |
| GET | `/api/votes/me` | voter | → `VoteReceipt[]` |

`POST /api/votes` is the most security-critical endpoint in the system:

1. Authenticate; load the user fresh from the database.
2. Re-check **every** eligibility rule server-side. Never trust the client's own assessment.
3. Validate the ciphertext: `0x`-prefixed, exactly `len(n²)` bytes, numerically `< n²`.
4. Relay `castVote(chainElectionId, voterCommitment, ciphertext)`.
5. Wait for confirmation; persist the receipt; return it.
6. On `AlreadyVoted` → **`409`**. The frontend treats this as terminal and does not offer retry.

**Do not log the ciphertext alongside the user id.** Together they are the voter→ballot link the
whole design exists to prevent. Log the hash if you must log anything.

### Areas, transfers and disputes

The Upazila workflow: a voter belongs to exactly one area, may only take part in elections
for it, may ask to be moved, and may dispute a record they believe is wrong.

| Method | Path | Auth | Request → Response |
| --- | --- | --- | --- |
| GET | `/api/upazilas` | — | → `Upazila[]` — the public catalogue |
| POST | `/api/transfers` | voter | `{ toUpazilaId, evidence }` → `AreaTransferRequest` |
| GET | `/api/transfers/me` | voter | → `AreaTransferRequest[]` |
| POST | `/api/disputes` | voter | `{ category, detail }` → `Dispute` — **suspends eligibility** |
| GET | `/api/disputes/me` | voter | → `Dispute[]` |
| POST | `/api/admin/upazilas` | **admin** | `{ upazilaId, name, district? }` → `Upazila` |
| GET | `/api/admin/transfers` | **admin** | → `AreaTransferRequest[]` (pending) |
| POST | `/api/admin/transfers/:id/decide` | **admin** | `{ approve, reason? }` → `AreaTransferRequest` |
| GET | `/api/admin/disputes` | **admin** | → `Dispute[]` (open) |
| POST | `/api/admin/disputes/:id/resolve` | **admin** | `{ outcome, resolution, correctedUpazilaId? }` → `Dispute` |

`EligibilityResult.reason` gains **`wrong-area`** and **`account-on-hold`**; when the reason
is `wrong-area` the response also carries `voterUpazilaName` and `electionUpazilaName` so the
UI can name both.

**The transfer cutoff lives here, not in the contract.** A transfer is refused once an
election the voter could take part in has passed its candidate-registration deadline and has
not yet closed. Enforcing it on-chain would mean iterating every election on every transfer;
the backend already knows the schedule. It is re-checked at decision time, because an
election may have opened since the request was filed.

### Admin

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/admin/stats` | `AdminStats` |
| GET | `/api/admin/voters` | `VoterSummary[]` — **masked NIDs only** |
| POST | `/api/admin/voters/:id/revoke` | `VoterSummary` |
| POST | `/api/admin/elections/:id/publish-result` | `ElectionResult` |

`publish-result`: verify shares ≥ threshold, combine off-chain (§6.2), unpack, call
`publishResult(id, totals)`, persist, return. Refuse with `409` if the threshold is not met — and
note the contract will refuse too, which is the real guarantee.

### Trustee

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/api/trustee/elections` | **trustee** | `TrusteeElection[]` |
| GET | `/api/trustee/elections/:id/tally` | **trustee** | `EncryptedTally` |
| POST | `/api/trustee/elections/:id/share` | **trustee** | `DecryptionShareSubmission` |

> **DECIDED: Option 1 — trustee-side.** The trustee's key share never reaches the backend.
>
> The backend generates the shares at election creation, returns them **once** in that response for
> out-of-band delivery, and stores none of them (asserted by a test). A trustee computes their
> partial decryption locally with `yarn trustee:share` and submits it with their own key.
>
> This was also the only workable option: `submitDecryptionShare` requires `msg.sender` to be a
> trustee of that election, so the relayer cannot send it for them. `POST .../share` therefore
> **reconciles** a submission that has already happened on-chain, and returns **428 Precondition
> Required** — with an explanation — until it has. It never accepts a share in a request body.

---

## 12. Security requirements

Non-negotiable:

- Validate every input with Zod at the route boundary; never pass raw `req.body` to Mongoose.
- Never interpolate user input into a Mongo query object (NoSQL injection).
- Authorise on the **server-resolved** user, never on a client-supplied role, id or eligibility flag.
- Enforce object ownership: a voter may read only their own receipts and candidacies (IDOR).
- Restrict selfie uploads by MIME type and size (≤ 5 MB); never write them to disk.
- Tighten rate limits on auth and voting routes.
- Return no sensitive detail in error messages — log it server-side instead.
- Keep every secret in the environment; nothing in source; `.env` stays git-ignored.

**Never log:** raw NID · passwords · selfie images or embeddings · private keys · trustee shares ·
JWTs · ciphertexts paired with a user id.

---

## 13. Testing

Extend `tests/` (Vitest + Supertest). Required coverage:

**Crypto** — encrypt/decrypt round-trip; homomorphic addition; **threshold: any `k` of `n` combine
correctly, `k−1` do not**; base-`B` packing and unpacking; byte-width and padding of every wire value.

**Auth** — successful registration; unknown NID; name/DOB mismatch; under age; **duplicate NID →
409**; face below threshold; expired registration token → 410; login success; wrong password;
revoked account; both facial-verification modes.

**Authorisation** — each admin route rejects a voter and a trustee; each trustee route rejects a
voter and an admin; a voter cannot read another voter's receipts.

**Elections and candidates** — creation validation (dates, threshold ≥ 2); transitions in and out of
order; candidate application by a non-voter; duplicate application; application after the deadline;
approval assigns `ballotIndex`; **only approved candidates appear once voting opens**.

**Voting** — eligible vote succeeds; **second vote returns 409**; vote before `startTime`; after
`endTime`; from a revoked voter; malformed ciphertext (wrong length, not reduced).

**Trustee and results** — share submission; duplicate share; non-trustee rejected; publish below
threshold rejected; publish at threshold succeeds; totals match the plaintext sum.

**Blockchain integration** — against a local Hardhat node: relayer without `RELAYER_ROLE` fails
cleanly; each contract custom error maps to the right HTTP status; the event listener reconciles.

---

## 14. Definition of done

- [x] No route returns `501`
- [x] `yarn test` green (65); `yarn typecheck` and `yarn lint` clean
- [x] `yarn sync:contracts --check` passes
- [x] Every endpoint in §11 matches `backend.contract.ts` exactly
- [x] Frontend runs with `VITE_USE_MOCK_API=false` and every endpoint works against the real API
- [x] Threshold decryption verified against a known tally, end to end (3 / 1 / 2 → `[3, 1, 2]`)
- [x] Raw NID appears in no log, no response, and nowhere on-chain
- [x] Trustee key shares are never persisted by the backend
- [x] `.env.example` updated; no secret committed
- [x] The end-to-end scenario in [`../INTEGRATION.md`](../INTEGRATION.md) passes — `yarn e2e`
