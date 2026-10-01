# E-Voting System — Backend

REST API for the blockchain-based E-Voting System (MCSE project, Bangladesh University of Professionals).
It holds voter identity off-chain in MongoDB, relays every on-chain action through a single signer,
and opens election results with threshold cryptography it cannot perform alone.

**Status:** implemented. 65 tests passing, plus a 20-step end-to-end scenario (`yarn e2e`) that runs
against the real contract and the real database.

---

## What this service is responsible for

| Concern | How it is handled |
| --- | --- |
| Identity | National ID encrypted at rest; only a salted commitment ever reaches the chain |
| Authentication | Argon2id passwords, JWT sessions, roles re-read from the database per request |
| On-chain writes | A single relayer signer, serialised and nonce-managed |
| Ballot secrecy | Ciphertexts are relayed, never decrypted — the key is split across trustees at setup |
| Results | Threshold shares combined off-chain, totals published on-chain |
| Cache | Mongo mirrors chain state; an event listener reconciles it continuously |

The chain is authoritative throughout. Where the database and the contract disagree, the contract wins.

---

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js (ESM) + TypeScript 6 |
| HTTP | Express 5 |
| Database | MongoDB + Mongoose 9 |
| Blockchain | Ethers v6 |
| Cryptography | Paillier + Damgård–Jurik threshold decryption over native `BigInt` |
| Passwords | Argon2id |
| Validation | Zod 4 (environment and every request body) |
| Security | Helmet, CORS, global and per-route rate limits |
| Tests | Vitest + Supertest |
| Package manager | Yarn 4 (`nodeLinker: node-modules`) |

---

## Requirements

- Node.js **20.19+**
- Yarn (pinned in `.yarnrc.yml`)
- MongoDB 6+
- A deployed `VotingRegistry` and an RPC endpoint — see the
  [contracts INTEGRATION guide](../e-voting-system-smart-contracts/INTEGRATION.md)

---

## Local bring-up

```bash
# 1 — contracts (in the contracts repo)
yarn hardhat node                                   # terminal 1
yarn deploy:local                                   # note the address
CONTRACT_ADDRESS=0x… BACKEND_SIGNER=0x… \
  TRUSTEE_ADDRESSES=0x…,0x…,0x… yarn grant:roles    # roles for the backend and trustees
yarn export:abi

# 2 — backend
yarn
yarn sync:contracts
cp .env.example .env     # fill in CONTRACT_ADDRESS, BACKEND_PRIVATE_KEY, the secrets
yarn seed:demo           # admin, trustee and demo voter accounts
yarn dev

# 3 — confirm the wiring
curl http://localhost:5000/api/blockchain/status     # expect relayerAuthorized: true
```

> **macOS:** port 5000 belongs to AirPlay Receiver. Use `PORT=5050` (and point the frontend's
> `VITE_API_URL` at it) or turn AirPlay Receiver off.

If `relayerAuthorized` is `false`, the role grant did not happen and every write will revert. The
server warns about this at startup rather than letting it surface as a failed registration.

---

## Environment variables

Copy `.env.example`. Everything is validated by Zod at startup; an invalid value stops the server with
a message naming the variable — never its value.

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT`, `NODE_ENV` | no | |
| `MONGODB_URI` | **yes** | |
| `CORS_ORIGIN` | no | Comma-separated; must include the frontend origin |
| `BLOCKCHAIN_RPC_URL`, `CONTRACT_ADDRESS` | for chain features | |
| `BACKEND_PRIVATE_KEY` | for chain features | **Secret.** Must hold `RELAYER_ROLE` and `ELECTION_ADMIN_ROLE` |
| `TRUSTEE_ADDRESSES` | for elections | The trustee committee's signing addresses |
| `JWT_SECRET` | production | **Secret.** ≥ 32 characters |
| `NID_HMAC_PEPPER` | production | **Secret.** What keeps a 13-digit NID un-brute-forceable |
| `PII_ENCRYPTION_KEY` | production | **Secret.** 32 bytes of hex, AES-256-GCM at rest |
| `PAILLIER_KEY_BITS` | no | Default 2048; must be a multiple of 256 |
| `BALLOT_BASE_BITS` | no | Default 32 — the per-candidate counter width |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` | no | Global limit; per-route limits are tighter |
| `FACIAL_VERIFICATION_MODE` | no | `registration_only` or `login_and_registration` |
| `NID_PROVIDER`, `FACE_PROVIDER` | no | `mock` is **refused** when `NODE_ENV=production` |

Development defaults exist for the secrets so the project runs out of the box; startup refuses every
one of them when `NODE_ENV=production`.

---

## Commands

| Command | Description |
| --- | --- |
| `yarn dev` | Watch mode |
| `yarn build` / `yarn start` | Compile to `dist/`, then run it |
| `yarn test` | Vitest + Supertest (needs MongoDB; does not need a chain) |
| `yarn lint` / `yarn typecheck` | |
| `yarn sync:contracts` | Regenerate the ABI from the contracts repo (`--check` in CI) |
| `yarn seed:demo` | Admin, trustee and demo voter accounts (refused in production) |
| `yarn e2e` | The 20-step end-to-end scenario against a live chain |
| `yarn trustee:share` | **Trustee tool** — see below |

---

## API

Response envelope: `{ success: true, data }` or `{ success: false, message, errors? }`.
The full reference is in [INTEGRATION.md](INTEGRATION.md) §11.

| Area | Routes |
| --- | --- |
| Auth | `GET /api/auth/config`, `POST /api/auth/register/{verify-nid,verify-face,complete}`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` |
| Elections | `GET /api/elections`, `GET /api/elections/:id`, `GET /api/elections/:id/eligibility`, `GET /api/elections/:id/results`, `POST /api/elections`, `POST /api/elections/:id/transition` |
| Candidates | `POST /api/elections/:id/candidates`, `GET /api/candidates/me`, `PATCH /api/admin/candidates/:id` |
| Voting | `POST /api/votes`, `GET /api/votes/me` |
| Admin | `GET /api/admin/stats`, `GET /api/admin/voters`, `POST /api/admin/voters/:id/revoke`, `POST /api/admin/elections/:id/publish-result` |
| Trustee | `GET /api/trustee/elections`, `GET /api/trustee/elections/:id/tally`, `POST /api/trustee/elections/:id/share` |
| Ops | `GET /api/health`, `GET /api/blockchain/status` |

Status codes are part of the contract — the UI renders different screens for `409` (already
registered, already voted), `410` (expired registration session), `422` (age or detail mismatch) and
`428` (a step that must happen elsewhere first).

---

## Cryptography

`src/crypto/` holds the whole scheme, over native `BigInt`:

- **`paillier.ts`** — key generation with safe primes, and the encryption the frontend mirrors
  byte-for-byte: `E(m, r) = (1 + m·n)·rⁿ mod n²`, big-endian and zero-padded to `len(n²)`.
- **`threshold.ts`** — Damgård–Jurik threshold decryption. The private key is Shamir-shared over
  `Z_{nm}` at setup; any `k` trustees can open the aggregate, `k−1` learn nothing.
- **`commitment.ts`** — the two NID derivations. A peppered HMAC detects duplicates; a per-voter
  salted commitment is what goes on-chain. Each is useless for the other's job, which is why both exist.
- **`pii.ts`** — AES-256-GCM for data at rest.

Ballots are packed in base `B = 2^BALLOT_BASE_BITS`, one digit per candidate, so a single decryption
of the aggregate yields every total at once.

### Where the trustee shares live — and why not here

**The backend never holds a trustee's key share.** It generates the shares when an election is
created, returns them **once** in that response for out-of-band delivery, and forgets them. Nothing
writes them to the database or the logs.

A trustee computes their partial decryption on their own machine:

```bash
BLOCKCHAIN_RPC_URL=… CONTRACT_ADDRESS=… TRUSTEE_PRIVATE_KEY=… \
  yarn trustee:share --election 1 --share ./trustee-1.share.json
```

This is not only the honest arrangement, it is the only one the contract allows:
`submitDecryptionShare` requires `msg.sender` to be a trustee of that election, so the relayer could
not submit on a trustee's behalf even if it held the share. `POST /api/trustee/elections/:id/share`
therefore reconciles what the trustee already submitted, and answers **428** until they have.

---

## Project structure

```text
src/
├── blockchain/    Provider, relayer signer, contract, generated ABI, chain clock, error mapping
├── config/        env.ts (Zod-validated), database.ts
├── controllers/   Request handlers
├── crypto/        Paillier, threshold decryption, commitments, PII encryption
├── mappers/       Contract structs → typed TypeScript
├── middleware/    Auth guards, rate limits, validation, error handler
├── models/        Mongoose models
├── providers/     NID and face adapters (mock implementations, swappable by env)
├── routes/        Express routers mounted under /api
├── services/      Auth, relayer, elections, candidates, voting, trustees, results, events, audit
├── tools/         seed-demo, trustee-client, e2e
├── types/         Enums mirrored from Solidity
└── utils/         ApiError, logger
tests/             Vitest suites, with a scripted stand-in for the chain
```

---

## Testing

```bash
yarn test     # 65 tests: crypto, auth, authorisation, elections, candidates, voting, trustees
yarn e2e      # the full scenario against a live chain — see INTEGRATION.md §4
```

The unit suite uses a **scripted stand-in for the contract** (`tests/helpers/fakeChain.ts`) that
enforces the same rules — duplicate votes, lifecycle order, trustee membership — so the tests stay
fast and deterministic while still testing real behaviour. It needs MongoDB but no chain. The real
contract, real ciphertexts and real threshold decryption are covered by `yarn e2e`.

The check that matters most is in `yarn e2e`: a known 3 / 1 / 2 distribution of encrypted ballots
must decrypt to exactly `[3, 1, 2]`.

---

## What this service does not do

- It **cannot decrypt a ballot.** It does not hold the key, and the aggregate needs a trustee quorum.
- It **cannot prove a ballot is well-formed.** Without a zero-knowledge proof, a malicious client
  could encrypt a value that is not a valid vote. The total is checked against the recorded ballot
  count before publication, which catches the clumsy cases and not the careful ones.
- It **cannot prove a trustee decrypted honestly** — that needs proofs of correct decryption.
- It **trusts itself at key-generation time**, absent a distributed key generation protocol.

These are documented limitations, not oversights. See the
[contracts README](../e-voting-system-smart-contracts/README.md#cryptography).
