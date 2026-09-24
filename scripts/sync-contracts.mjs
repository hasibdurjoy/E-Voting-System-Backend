/**
 * Copies the contract ABI from the smart-contracts repository into src/blockchain/abi/.
 *
 *     yarn sync:contracts          # regenerate from the sibling repo
 *     yarn sync:contracts --check  # fail if the committed ABI has drifted (use in CI)
 *
 * The contracts repository is the source of truth: run `yarn compile && yarn export:abi`
 * there first. Set CONTRACTS_REPO_PATH if it is not the default sibling directory.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACTS_REPO = resolve(ROOT, process.env.CONTRACTS_REPO_PATH ?? '../e-voting-system-smart-contracts')
const CONTRACT_NAME = 'VotingRegistry'
const OUT_FILE = join(ROOT, 'src/blockchain/abi', `${CONTRACT_NAME}.generated.ts`)

const checkOnly = process.argv.includes('--check')

const sourcePath = join(CONTRACTS_REPO, 'abi', `${CONTRACT_NAME}.json`)
let source
try {
  source = readFileSync(sourcePath, 'utf8')
} catch {
  console.error(`Cannot read ${sourcePath}`)
  console.error('Run `yarn compile && yarn export:abi` in the smart-contracts repository first,')
  console.error('or set CONTRACTS_REPO_PATH to its location.')
  process.exit(1)
}

const abi = JSON.parse(source)
const abiSha256 = createHash('sha256').update(source).digest('hex')

const contents = `/**
 * GENERATED FILE — DO NOT EDIT.
 * Source: e-voting-system-smart-contracts/abi/${CONTRACT_NAME}.json
 * Regenerate with \`yarn sync:contracts\`; verify with \`yarn sync:contracts --check\`.
 *
 * sha256: ${abiSha256}
 */
export const VOTING_REGISTRY_ABI_SHA256 = '${abiSha256}' as const

export const VOTING_REGISTRY_ABI = ${JSON.stringify(abi, null, 2)} as const
`

if (checkOnly) {
  let current
  try {
    current = readFileSync(OUT_FILE, 'utf8')
  } catch {
    console.error(`${OUT_FILE} is missing. Run \`yarn sync:contracts\`.`)
    process.exit(1)
  }
  if (current !== contents) {
    console.error('Contract ABI is out of date with the smart-contracts repository.')
    console.error('Run `yarn sync:contracts` and commit the result.')
    process.exit(1)
  }
  console.log(`ABI is in sync (sha256 ${abiSha256.slice(0, 12)}…, ${abi.length} entries).`)
} else {
  writeFileSync(OUT_FILE, contents)
  console.log(`Wrote ${OUT_FILE} (${abi.length} entries, sha256 ${abiSha256.slice(0, 12)}…).`)
}
