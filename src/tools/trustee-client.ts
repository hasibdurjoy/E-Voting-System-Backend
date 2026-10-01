/**
 * Trustee client — run by a trustee, on the trustee's own machine.
 *
 *     yarn trustee:share --election 1 --share ./trustee-1.share.json
 *
 * This is the only place a key share is ever read, and it is deliberately NOT part of the
 * server. The share stays on the trustee's disk; the partial decryption is computed locally;
 * the transaction is signed with the trustee's own key.
 *
 * That is not merely good practice — the contract requires it. `submitDecryptionShare`
 * checks `msg.sender` against the election's trustee list, so a share submitted by the
 * backend relayer would be rejected. The threshold property and the contract agree.
 *
 * Environment (the trustee's own .env, not the server's):
 *     BLOCKCHAIN_RPC_URL     the node to talk to
 *     CONTRACT_ADDRESS       the VotingRegistry address
 *     TRUSTEE_PRIVATE_KEY    this trustee's key — never leaves this machine
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import dotenv from 'dotenv'
import { Contract, JsonRpcProvider, Wallet } from 'ethers'
import { VOTING_REGISTRY_ABI } from '../blockchain/abi/index.js'
import { hexToBigInt } from '../crypto/bigint.js'
import { deserialisePublicKey } from '../crypto/paillier.js'
import { deserialiseTrusteeShare, partialDecrypt, serialiseShare } from '../crypto/threshold.js'

// The trustee's own .env — their RPC endpoint, the contract address and their key.
dotenv.config({ quiet: true })

interface Options {
  election: number
  sharePath: string
  rpcUrl: string
  contractAddress: string
  privateKey: string
}

function parseOptions(): Options {
  const { values } = parseArgs({
    options: {
      election: { type: 'string' },
      share: { type: 'string' },
    },
  })

  const election = Number(values.election)
  const sharePath = values.share
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL
  const contractAddress = process.env.CONTRACT_ADDRESS
  const privateKey = process.env.TRUSTEE_PRIVATE_KEY

  const missing: string[] = []
  if (!Number.isInteger(election) || election < 1) missing.push('--election <id>')
  if (!sharePath) missing.push('--share <path to your share file>')
  if (!rpcUrl) missing.push('BLOCKCHAIN_RPC_URL')
  if (!contractAddress) missing.push('CONTRACT_ADDRESS')
  if (!privateKey) missing.push('TRUSTEE_PRIVATE_KEY')

  if (missing.length > 0) {
    console.error(`Missing: ${missing.join(', ')}`)
    console.error('Usage: yarn trustee:share --election <id> --share <file>')
    process.exit(1)
  }

  return {
    election,
    sharePath: sharePath!,
    rpcUrl: rpcUrl!,
    contractAddress: contractAddress!,
    privateKey: privateKey!,
  }
}

async function main(): Promise<void> {
  const options = parseOptions()

  const provider = new JsonRpcProvider(options.rpcUrl)
  const wallet = new Wallet(options.privateKey, provider)
  const contract = new Contract(options.contractAddress, VOTING_REGISTRY_ABI, wallet)

  console.log(`Trustee:   ${wallet.address}`)
  console.log(`Election:  ${options.election}`)

  const isTrustee = (await contract.isElectionTrustee(options.election, wallet.address)) as boolean
  if (!isTrustee) {
    console.error('This address is not a trustee of that election.')
    process.exit(1)
  }
  if ((await contract.hasSubmittedShare(options.election, wallet.address)) as boolean) {
    console.log('A decryption share has already been submitted by this trustee. Nothing to do.')
    return
  }

  // The share file never leaves this process, and nothing here prints it.
  const share = deserialiseTrusteeShare(readFileSync(options.sharePath, 'utf8'))

  const [n] = (await contract.getElectionKey(options.election)) as [string, string]
  const publicKey = deserialisePublicKey(n)
  const aggregate = hexToBigInt((await contract.getEncryptedTally(options.election)) as string)

  const partial = partialDecrypt(aggregate, { value: share.value }, share.delta, publicKey)
  const serialised = serialiseShare(partial, publicKey)
  console.log(`Computed partial decryption (${(serialised.length - 2) / 2} bytes)`)

  const tx = await contract.submitDecryptionShare(options.election, serialised)
  const receipt = await tx.wait()
  console.log(`Submitted in block ${receipt?.blockNumber} (tx ${receipt?.hash})`)

  const election = (await contract.getElection(options.election)) as {
    decryptionShareCount: bigint
    trusteeThreshold: bigint
  }
  const soFar = Number(election.decryptionShareCount)
  const threshold = Number(election.trusteeThreshold)
  console.log(`Shares submitted: ${soFar}/${threshold}${soFar >= threshold ? ' — threshold reached' : ''}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
