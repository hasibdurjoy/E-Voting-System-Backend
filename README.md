# E-Voting System — Backend

REST API for the blockchain-based E-Voting System (MCSE project, Bangladesh University of Professionals).
It stores off-chain application data in MongoDB and talks to the `VotingRegistry`
[smart contract](../e-voting-system-smart-contracts) through Ethers.js.

> **Status:** technical foundation only. Module routes are placeholders that respond `501 Not Implemented`.

## Tech stack

| Concern         | Choice                                                   |
| --------------- | -------------------------------------------------------- |
| Runtime         | Node.js (ESM) + TypeScript 6                             |
| HTTP            | Express 5                                                |
| Database        | MongoDB + Mongoose 9                                     |
| Blockchain      | Ethers.js v6                                             |
| Validation      | Zod 4 (environment + request schemas)                    |
| Security        | Helmet, CORS, express-rate-limit                         |
| Logging         | Morgan (requests) + small logger utility                 |
| Dev runner      | tsx (watch mode)                                         |
| Tests           | Vitest + Supertest                                       |
| Linting         | ESLint 10 flat config + typescript-eslint                |
| Package manager | Yarn 4 (pinned in `.yarn/releases`, `nodeLinker: node-modules`) |

## Requirements

- Node.js **20.19+** (22 LTS or 24 recommended)
- Yarn (the repo pins Yarn 4 via `.yarnrc.yml`)
- MongoDB 6+ running locally or a MongoDB Atlas connection string

## MongoDB setup

Local (Homebrew on macOS):

```bash
brew services start mongodb-community
mongosh --eval 'db.runCommand({ ping: 1 })'   # should print { ok: 1 }
```

Or use Atlas and set `MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/e_voting_system` in `.env`.
The server refuses to start if MongoDB is unreachable and prints the (credential-redacted) URI and reason.

## Environment variables

Copy `.env.example` to `.env`. Variables are validated with Zod at startup (`src/config/env.ts`);
invalid values stop the server with a message naming the variable (values are never printed).

| Variable              | Required | Default                   | Description                                        |
| --------------------- | -------- | ------------------------- | -------------------------------------------------- |
| `PORT`                | no       | `5000`                    | HTTP port                                          |
| `NODE_ENV`            | no       | `development`             | `development` \| `test` \| `production`           |
| `MONGODB_URI`         | **yes**  | —                         | MongoDB connection string                          |
| `CORS_ORIGIN`         | no       | `http://localhost:5173`   | Allowed origin(s), comma-separated                 |
| `BLOCKCHAIN_RPC_URL`  | no*      | —                         | JSON-RPC endpoint (`http://127.0.0.1:8545` locally)|
| `CONTRACT_ADDRESS`    | no*      | —                         | Deployed `VotingRegistry` address                  |
| `BACKEND_PRIVATE_KEY` | no*      | —                         | **Secret.** Backend signer key (0x + 64 hex)       |

\* Optional until blockchain features are used. `BACKEND_PRIVATE_KEY` must never be committed, logged,
or shared with the frontend.

> **macOS note:** port 5000 is used by *AirPlay Receiver*. Either disable it
> (System Settings → General → AirDrop & Handoff) or set another port, e.g. `PORT=5050`, and update the
> frontend's `VITE_API_URL` to match.

## Commands

| Command          | Description                                   |
| ---------------- | --------------------------------------------- |
| `yarn dev`       | Start in watch mode with tsx                  |
| `yarn build`     | Compile TypeScript to `dist/`                 |
| `yarn start`     | Run the compiled server (`dist/server.js`)    |
| `yarn test`      | Run tests (Vitest + Supertest, no DB needed)  |
| `yarn lint`      | Run ESLint (`yarn lint:fix` to auto-fix)      |
| `yarn typecheck` | Type-check `src/` and `tests/`                |

## API

| Method | Path                     | Description                                             |
| ------ | ------------------------ | ------------------------------------------------------- |
| GET    | `/api/health`            | Health check                                            |
| GET    | `/api/blockchain/status` | RPC / contract / backend-wallet connectivity check      |
| *      | `/api/auth`              | Placeholder (501)                                       |
| *      | `/api/users`             | Placeholder (501)                                       |
| *      | `/api/elections`         | Placeholder (501)                                       |
| *      | `/api/candidates`        | Placeholder (501)                                       |
| *      | `/api/votes`             | Placeholder (501)                                       |
| *      | `/api/admin`             | Placeholder (501)                                       |

```bash
curl http://localhost:5000/api/health
# {"success":true,"message":"E-Voting System API is running"}
```

Errors always use the shape `{ "success": false, "message": "...", "errors"?: [...] }` via the central
error handler (`src/middleware/errorHandler.ts`). Throw `ApiError` for expected errors; Express 5 forwards
rejected promises from async handlers automatically.

## Blockchain configuration

`src/blockchain/` isolates all Ethers.js code:

- `provider.ts` — shared `JsonRpcProvider` for `BLOCKCHAIN_RPC_URL`
- `wallet.ts` — backend `Wallet` signer from `BACKEND_PRIVATE_KEY`
- `contract.ts` — read-only and signer-connected `VotingRegistry` contract instances
- `abi/VotingRegistry.ts` — contract ABI (keep in sync with the contracts repo)

Local example (with `yarn hardhat node` running in the contracts repo and the contract deployed):

```env
BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
CONTRACT_ADDRESS=<address printed by the deploy script>
```

Then `GET /api/blockchain/status` returns the chain ID, block number and contract owner.

## Project structure

```text
src/
├── blockchain/    Ethers.js provider, wallet, contract, ABI
├── config/        env.ts (Zod-validated env), database.ts (Mongoose connection)
├── controllers/   Request handlers
├── middleware/    Security, logging, validation, 404, error handler
├── models/        Mongoose models (to be added)
├── routes/        Express routers, mounted under /api
├── services/      Business logic
├── types/         Shared TypeScript types
├── utils/         ApiError, logger
├── validators/    Reusable Zod request schemas
├── app.ts         Express app factory (used by server and tests)
└── server.ts      Connects MongoDB, starts HTTP server, graceful shutdown
tests/             Vitest + Supertest tests
```
