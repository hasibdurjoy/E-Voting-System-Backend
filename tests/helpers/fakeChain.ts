/**
 * An in-memory stand-in for the deployed contract.
 *
 * It exists so the HTTP layer — guards, status codes, validation, eligibility — can be
 * tested deterministically and in milliseconds. It mirrors the contract's RULES, not its
 * implementation: duplicate votes, lifecycle order and trustee membership are all enforced
 * here the way `VotingRegistry` enforces them, so a test that passes against this fake is
 * testing the backend's behaviour rather than a shape it invented.
 *
 * It is NOT a substitute for running against the chain: `yarn e2e` does that, with the real
 * contract, real Paillier ciphertexts and real threshold decryption.
 */
import { keccak256 } from 'ethers'
import { CandidateStatus, ElectionStatus } from '../../src/types/domain.js'

export class ContractRevert extends Error {
  readonly revert: { name: string; args: unknown[] }
  constructor(name: string, args: unknown[] = []) {
    super(`execution reverted: ${name}`)
    this.name = 'ContractRevert'
    this.revert = { name, args }
  }
}

interface FakeCandidate {
  id: number
  ballotIndex: number
  voterCommitment: string
  profileHash: string
  status: number
}

interface FakeElection {
  id: number
  name: string
  description: string
  candidateRegistrationEnd: bigint
  startTime: bigint
  endTime: bigint
  status: number
  candidates: FakeCandidate[]
  approvedOrder: number[]
  voteCount: number
  votes: Map<string, string>
  trustees: string[]
  trusteeThreshold: number
  shares: Map<string, string>
  publicKeyN: string
  publicKeyNSquared: string
  encryptedTally: string
  result: number[]
}

const KEY_BYTES = 64 // 512-bit n keeps the fixtures readable; the width rules still apply

function hexOfWidth(seed: number, bytes: number): string {
  return `0x${seed.toString(16).padStart(bytes * 2, '0')}`
}

export class FakeChain {
  readonly voters = new Map<string, { revoked: boolean; wallet: string; registeredAt: number }>()
  readonly elections = new Map<number, FakeElection>()
  blockNumber = 100

  reset(): void {
    this.voters.clear()
    this.elections.clear()
    this.blockNumber = 100
  }

  // ── writes (what the relayer would send) ───────────────────────────────────

  registerVoter(commitment: string, wallet: string): void {
    if (!commitment || /^0x0+$/.test(commitment)) throw new ContractRevert('EmptyCommitment')
    if (this.voters.has(commitment)) throw new ContractRevert('VoterAlreadyRegistered', [commitment])
    this.voters.set(commitment, { revoked: false, wallet, registeredAt: Math.floor(Date.now() / 1000) })
  }

  revokeVoter(commitment: string): void {
    const voter = this.voters.get(commitment)
    if (!voter) throw new ContractRevert('VoterNotRegistered', [commitment])
    if (voter.revoked) throw new ContractRevert('VoterRevokedError', [commitment])
    voter.revoked = true
  }

  createElection(
    name: string,
    description: string,
    candidateRegistrationEnd: bigint,
    startTime: bigint,
    endTime: bigint,
  ): number {
    if (candidateRegistrationEnd > startTime || startTime >= endTime) {
      throw new ContractRevert('InvalidElectionPeriod', [startTime, endTime])
    }
    const id = this.elections.size + 1
    this.elections.set(id, {
      id,
      name,
      description,
      candidateRegistrationEnd,
      startTime,
      endTime,
      status: ElectionStatus.Draft,
      candidates: [],
      approvedOrder: [],
      voteCount: 0,
      votes: new Map(),
      trustees: [],
      trusteeThreshold: 0,
      shares: new Map(),
      publicKeyN: '',
      publicKeyNSquared: '',
      encryptedTally: hexOfWidth(1, KEY_BYTES * 2),
      result: [],
    })
    return id
  }

  private election(id: number): FakeElection {
    const election = this.elections.get(id)
    if (!election) throw new ContractRevert('ElectionNotFound', [id])
    return election
  }

  setElectionKey(id: number, n: string, nSquared: string): void {
    const election = this.election(id)
    if (election.status !== ElectionStatus.Draft) {
      throw new ContractRevert('UnexpectedElectionStatus', [id, ElectionStatus.Draft, election.status])
    }
    election.publicKeyN = n
    election.publicKeyNSquared = nSquared
  }

  setElectionTrustees(id: number, trustees: string[], threshold: number): void {
    const election = this.election(id)
    if (threshold < 2 || threshold > trustees.length) throw new ContractRevert('InvalidTrusteeSet')
    election.trustees = trustees.map((address) => address.toLowerCase())
    election.trusteeThreshold = threshold
  }

  openCandidateRegistration(id: number): void {
    const election = this.election(id)
    if (election.status !== ElectionStatus.Draft) {
      throw new ContractRevert('UnexpectedElectionStatus', [id, ElectionStatus.Draft, election.status])
    }
    if (!election.publicKeyN || election.trustees.length === 0) throw new ContractRevert('PublicKeyNotConfigured', [id])
    election.status = ElectionStatus.CandidateRegistration
  }

  openVoting(id: number): void {
    const election = this.election(id)
    if (election.status !== ElectionStatus.CandidateRegistration) {
      throw new ContractRevert('UnexpectedElectionStatus', [id, ElectionStatus.CandidateRegistration, election.status])
    }
    if (election.approvedOrder.length === 0) throw new ContractRevert('NoApprovedCandidates', [id])
    election.status = ElectionStatus.Voting
  }

  closeElection(id: number): void {
    const election = this.election(id)
    if (election.status !== ElectionStatus.Voting) {
      throw new ContractRevert('UnexpectedElectionStatus', [id, ElectionStatus.Voting, election.status])
    }
    if (BigInt(Math.floor(Date.now() / 1000)) < election.endTime) throw new ContractRevert('ElectionNotEnded', [id])
    election.status = ElectionStatus.Closed
  }

  registerCandidate(id: number, commitment: string, profileHash: string): number {
    const election = this.election(id)
    if (election.status !== ElectionStatus.CandidateRegistration) {
      throw new ContractRevert('UnexpectedElectionStatus', [id, ElectionStatus.CandidateRegistration, election.status])
    }
    const voter = this.voters.get(commitment)
    if (!voter || voter.revoked) throw new ContractRevert('VoterNotRegistered', [commitment])
    if (election.candidates.some((candidate) => candidate.voterCommitment === commitment)) {
      throw new ContractRevert('CandidateAlreadyRegistered', [id, commitment])
    }
    const candidateId = election.candidates.length + 1
    election.candidates.push({
      id: candidateId,
      ballotIndex: 0,
      voterCommitment: commitment,
      profileHash,
      status: CandidateStatus.Pending,
    })
    return candidateId
  }

  setCandidateStatus(id: number, candidateId: number, status: number): void {
    const election = this.election(id)
    const candidate = election.candidates.find((entry) => entry.id === candidateId)
    if (!candidate) throw new ContractRevert('CandidateNotFound', [id, candidateId])
    if (candidate.status !== CandidateStatus.Pending) throw new ContractRevert('CandidateNotPending', [id, candidateId])
    if (![CandidateStatus.Approved, CandidateStatus.Rejected, CandidateStatus.Withdrawn].includes(status as never)) {
      throw new ContractRevert('InvalidCandidateStatus', [status])
    }
    candidate.status = status
    if (status === CandidateStatus.Approved) {
      // Ballot index is assigned in approval order, exactly as the contract does.
      candidate.ballotIndex = election.approvedOrder.length
      election.approvedOrder.push(candidate.id)
    }
  }

  castVote(id: number, commitment: string, ciphertext: string): void {
    const election = this.election(id)
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (election.status !== ElectionStatus.Voting || now < election.startTime || now >= election.endTime) {
      throw new ContractRevert('ElectionNotOpen', [id])
    }
    const voter = this.voters.get(commitment)
    if (!voter || voter.revoked) throw new ContractRevert('VoterNotRegistered', [commitment])
    if (election.votes.has(commitment)) throw new ContractRevert('AlreadyVoted', [id, commitment])

    const expected = (election.publicKeyNSquared.length - 2) / 2
    const actual = (ciphertext.length - 2) / 2
    if (actual !== expected) throw new ContractRevert('InvalidCiphertextLength', [expected, actual])
    if (BigInt(ciphertext) >= BigInt(election.publicKeyNSquared)) throw new ContractRevert('CiphertextNotReduced')

    election.votes.set(commitment, ciphertext)
    election.voteCount += 1
  }

  submitDecryptionShare(id: number, trustee: string, share: string): void {
    const election = this.election(id)
    const address = trustee.toLowerCase()
    if (election.status !== ElectionStatus.Closed) {
      throw new ContractRevert('UnexpectedElectionStatus', [id, ElectionStatus.Closed, election.status])
    }
    if (!election.trustees.includes(address)) throw new ContractRevert('NotAnElectionTrustee', [id, trustee])
    if (election.shares.has(address)) throw new ContractRevert('DecryptionShareAlreadySubmitted', [id, trustee])
    election.shares.set(address, share)
  }

  publishResult(id: number, totals: number[]): void {
    const election = this.election(id)
    if (election.shares.size < election.trusteeThreshold) {
      throw new ContractRevert('ThresholdNotReached', [id, election.shares.size, election.trusteeThreshold])
    }
    if (totals.length !== election.approvedOrder.length) {
      throw new ContractRevert('ResultLengthMismatch', [election.approvedOrder.length, totals.length])
    }
    election.result = totals
    election.status = ElectionStatus.ResultsPublished
  }

  // ── reads (the view surface the services use) ──────────────────────────────

  view(): Record<string, (...args: never[]) => unknown> {
    return {
      electionCount: () => BigInt(this.elections.size),
      getElection: (id: number) => {
        const election = this.election(Number(id))
        return {
          id: BigInt(election.id),
          name: election.name,
          description: election.description,
          candidateRegistrationEnd: election.candidateRegistrationEnd,
          startTime: election.startTime,
          endTime: election.endTime,
          status: BigInt(election.status),
          candidateCount: BigInt(election.candidates.length),
          approvedCandidateCount: BigInt(election.approvedOrder.length),
          voteCount: BigInt(election.voteCount),
          trusteeCount: BigInt(election.trustees.length),
          trusteeThreshold: BigInt(election.trusteeThreshold),
          decryptionShareCount: BigInt(election.shares.size),
        }
      },
      getCandidate: (id: number, candidateId: number) => {
        const election = this.election(Number(id))
        const candidate = election.candidates.find((entry) => entry.id === Number(candidateId))
        if (!candidate) throw new ContractRevert('CandidateNotFound', [id, candidateId])
        return {
          id: BigInt(candidate.id),
          ballotIndex: BigInt(candidate.ballotIndex),
          voterCommitment: candidate.voterCommitment,
          profileHash: candidate.profileHash,
          status: BigInt(candidate.status),
        }
      },
      getApprovedCandidates: (id: number) => this.election(Number(id)).approvedOrder.map((value) => BigInt(value)),
      getElectionKey: (id: number) => {
        const election = this.election(Number(id))
        return [election.publicKeyN || '0x', election.publicKeyNSquared || '0x']
      },
      getEncryptedTally: (id: number) => this.election(Number(id)).encryptedTally,
      getResult: (id: number) => this.election(Number(id)).result.map((value) => BigInt(value)),
      hasVoted: (id: number, commitment: string) => this.election(Number(id)).votes.has(commitment),
      isRegisteredVoter: (commitment: string) => {
        const voter = this.voters.get(commitment)
        return Boolean(voter && !voter.revoked)
      },
      getVoter: (commitment: string) => {
        const voter = this.voters.get(commitment)
        return {
          commitment,
          wallet: voter?.wallet ?? '0x0000000000000000000000000000000000000000',
          registeredAt: BigInt(voter?.registeredAt ?? 0),
          revoked: Boolean(voter?.revoked),
        }
      },
      isElectionTrustee: (id: number, address: string) =>
        this.election(Number(id)).trustees.includes(String(address).toLowerCase()),
      hasSubmittedShare: (id: number, address: string) =>
        this.election(Number(id)).shares.has(String(address).toLowerCase()),
      getDecryptionShare: (id: number, address: string) =>
        this.election(Number(id)).shares.get(String(address).toLowerCase()) ?? '0x',
      getElectionTrustees: (id: number) => this.election(Number(id)).trustees,
      RELAYER_ROLE: () => keccak256(Buffer.from('RELAYER_ROLE')),
      hasRole: () => true,
    }
  }
}

export const fakeChain = new FakeChain()

/** A contract object shaped like an ethers Contract, backed by the fake. */
export function fakeContract(): Record<string, unknown> {
  const views = fakeChain.view()
  return {
    ...Object.fromEntries(
      Object.entries(views).map(([name, fn]) => [name, (...args: never[]) => Promise.resolve(fn(...args))]),
    ),
    filters: new Proxy(
      {},
      {
        get: () => () => ({}),
      },
    ),
    queryFilter: () => Promise.resolve([]),
    interface: { parseLog: () => null },
  }
}

/** Applies a relayed write to the fake chain and returns a receipt-shaped result. */
export function fakeRelay(method: string, args: unknown[], sender = '0x0000000000000000000000000000000000000001') {
  const chain = fakeChain
  let returnValue: unknown

  switch (method) {
    case 'registerVoter':
      chain.registerVoter(String(args[0]), String(args[1]))
      break
    case 'revokeVoter':
      chain.revokeVoter(String(args[0]))
      break
    case 'createElection':
      returnValue = BigInt(
        chain.createElection(String(args[0]), String(args[1]), args[2] as bigint, args[3] as bigint, args[4] as bigint),
      )
      break
    case 'setElectionKey':
      chain.setElectionKey(Number(args[0]), String(args[1]), String(args[2]))
      break
    case 'setElectionTrustees':
      chain.setElectionTrustees(Number(args[0]), args[1] as string[], Number(args[2]))
      break
    case 'openCandidateRegistration':
      chain.openCandidateRegistration(Number(args[0]))
      break
    case 'openVoting':
      chain.openVoting(Number(args[0]))
      break
    case 'closeElection':
      chain.closeElection(Number(args[0]))
      break
    case 'registerCandidate':
      returnValue = BigInt(chain.registerCandidate(Number(args[0]), String(args[1]), String(args[2])))
      break
    case 'setCandidateStatus':
      chain.setCandidateStatus(Number(args[0]), Number(args[1]), Number(args[2]))
      break
    case 'castVote':
      chain.castVote(Number(args[0]), String(args[1]), String(args[2]))
      break
    case 'submitDecryptionShare':
      chain.submitDecryptionShare(Number(args[0]), sender, String(args[1]))
      break
    case 'publishResult':
      chain.publishResult(Number(args[0]), (args[1] as bigint[]).map(Number))
      break
    default:
      throw new Error(`fakeRelay does not implement ${method}`)
  }

  chain.blockNumber += 1
  return {
    txHash: keccak256(Buffer.from(`${method}:${chain.blockNumber}:${JSON.stringify(args.map(String))}`)),
    blockNumber: chain.blockNumber,
    returnValue,
    gasUsed: '21000',
  }
}
