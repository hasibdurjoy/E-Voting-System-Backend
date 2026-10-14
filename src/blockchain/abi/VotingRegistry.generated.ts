/**
 * GENERATED FILE — DO NOT EDIT.
 * Source: e-voting-system-smart-contracts/abi/VotingRegistry.json
 * Regenerate with `yarn sync:contracts`; verify with `yarn sync:contracts --check`.
 *
 * sha256: 74884ab86b3a2e531f403df48c365eb0246978fbde995f5b1524c16b1bc0ffde
 */
export const VOTING_REGISTRY_ABI_SHA256 = '74884ab86b3a2e531f403df48c365eb0246978fbde995f5b1524c16b1bc0ffde' as const

export const VOTING_REGISTRY_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "admin",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AccessControlBadConfirmation",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "neededRole",
        "type": "bytes32"
      }
    ],
    "name": "AccessControlUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "AlreadyVoted",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      }
    ],
    "name": "AreaUnchanged",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "CandidateAlreadyRegistered",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "uint32",
        "name": "candidateId",
        "type": "uint32"
      }
    ],
    "name": "CandidateNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "uint32",
        "name": "candidateId",
        "type": "uint32"
      }
    ],
    "name": "CandidateNotPending",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CiphertextNotReduced",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "trustee",
        "type": "address"
      }
    ],
    "name": "DecryptionShareAlreadySubmitted",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "ElectionNotEnded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "ElectionNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "ElectionNotOpen",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EmptyCommitment",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EmptyDecryptionShare",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EmptyElectionName",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EmptyUpazilaName",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "enum VotingRegistry.CandidateStatus",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "InvalidCandidateStatus",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "InvalidCiphertextLength",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "startTime",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "endTime",
        "type": "uint64"
      }
    ],
    "name": "InvalidElectionPeriod",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPublicKey",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidTrusteeSet",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "LengthMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ModExpFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ModulusNotOdd",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "NoApprovedCandidates",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "NotAnElectionTrustee",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "PublicKeyNotConfigured",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "ResultLengthMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "submitted",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "required",
        "type": "uint8"
      }
    ],
    "name": "ThresholdNotReached",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "enum VotingRegistry.ElectionStatus",
        "name": "expected",
        "type": "uint8"
      },
      {
        "internalType": "enum VotingRegistry.ElectionStatus",
        "name": "actual",
        "type": "uint8"
      }
    ],
    "name": "UnexpectedElectionStatus",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      }
    ],
    "name": "UnknownUpazila",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      }
    ],
    "name": "UpazilaAlreadyRegistered",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "VoterAlreadyRegistered",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "VoterNotRegistered",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "VoterOnHoldError",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "VoterRevokedError",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "expected",
        "type": "uint32"
      },
      {
        "internalType": "uint32",
        "name": "actual",
        "type": "uint32"
      }
    ],
    "name": "WrongUpazila",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint32",
        "name": "candidateId",
        "type": "uint32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "profileHash",
        "type": "bytes32"
      }
    ],
    "name": "CandidateRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint32",
        "name": "candidateId",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "enum VotingRegistry.CandidateStatus",
        "name": "status",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "ballotIndex",
        "type": "uint32"
      }
    ],
    "name": "CandidateStatusChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "trustee",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "sharesSoFar",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "share",
        "type": "bytes"
      }
    ],
    "name": "DecryptionShareSubmitted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "voteCount",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "encryptedTallyHash",
        "type": "bytes32"
      }
    ],
    "name": "ElectionClosed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "startTime",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "endTime",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      }
    ],
    "name": "ElectionCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "publicKeyN",
        "type": "bytes"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "trusteeThreshold",
        "type": "uint8"
      }
    ],
    "name": "ElectionKeyConfigured",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "enum VotingRegistry.ElectionStatus",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "ElectionStatusChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address[]",
        "name": "trustees",
        "type": "address[]"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "threshold",
        "type": "uint8"
      }
    ],
    "name": "ElectionTrusteesConfigured",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256[]",
        "name": "totals",
        "type": "uint256[]"
      }
    ],
    "name": "ResultPublished",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "previousAdminRole",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "newAdminRole",
        "type": "bytes32"
      }
    ],
    "name": "RoleAdminChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "RoleGranted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "RoleRevoked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "name",
        "type": "string"
      }
    ],
    "name": "UpazilaRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "ciphertextHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "voteIndex",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "ciphertext",
        "type": "bytes"
      }
    ],
    "name": "VoteCast",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "previousUpazilaId",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "newUpazilaId",
        "type": "uint32"
      }
    ],
    "name": "VoterAreaChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "onHold",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      }
    ],
    "name": "VoterHoldChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "registeredAt",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      }
    ],
    "name": "VoterRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "VoterRevoked",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "DEFAULT_ADMIN_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ELECTION_ADMIN_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "RELAYER_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "TRUSTEE_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "ciphertext",
        "type": "bytes"
      }
    ],
    "name": "castVote",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "closeElection",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "description",
        "type": "string"
      },
      {
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      },
      {
        "internalType": "uint64",
        "name": "candidateRegistrationEnd",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "startTime",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "endTime",
        "type": "uint64"
      }
    ],
    "name": "createElection",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "electionCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "getApprovedCandidates",
    "outputs": [
      {
        "internalType": "uint32[]",
        "name": "",
        "type": "uint32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "uint32",
        "name": "candidateId",
        "type": "uint32"
      }
    ],
    "name": "getCandidate",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint32",
            "name": "id",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "ballotIndex",
            "type": "uint32"
          },
          {
            "internalType": "bytes32",
            "name": "voterCommitment",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "profileHash",
            "type": "bytes32"
          },
          {
            "internalType": "enum VotingRegistry.CandidateStatus",
            "name": "status",
            "type": "uint8"
          }
        ],
        "internalType": "struct VotingRegistry.Candidate",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "trustee",
        "type": "address"
      }
    ],
    "name": "getDecryptionShare",
    "outputs": [
      {
        "internalType": "bytes",
        "name": "",
        "type": "bytes"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "getElection",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "id",
            "type": "uint256"
          },
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "description",
            "type": "string"
          },
          {
            "internalType": "uint32",
            "name": "upazilaId",
            "type": "uint32"
          },
          {
            "internalType": "uint64",
            "name": "candidateRegistrationEnd",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "startTime",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "endTime",
            "type": "uint64"
          },
          {
            "internalType": "enum VotingRegistry.ElectionStatus",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint32",
            "name": "candidateCount",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "approvedCandidateCount",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "voteCount",
            "type": "uint32"
          },
          {
            "internalType": "uint8",
            "name": "trusteeCount",
            "type": "uint8"
          },
          {
            "internalType": "uint8",
            "name": "trusteeThreshold",
            "type": "uint8"
          },
          {
            "internalType": "uint8",
            "name": "decryptionShareCount",
            "type": "uint8"
          }
        ],
        "internalType": "struct VotingRegistry.Election",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "getElectionKey",
    "outputs": [
      {
        "internalType": "bytes",
        "name": "n",
        "type": "bytes"
      },
      {
        "internalType": "bytes",
        "name": "nSquared",
        "type": "bytes"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "getElectionTrustees",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "getEncryptedTally",
    "outputs": [
      {
        "internalType": "bytes",
        "name": "",
        "type": "bytes"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "getResult",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      }
    ],
    "name": "getRoleAdmin",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      }
    ],
    "name": "getUpazilaName",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "getVoter",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "commitment",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "wallet",
            "type": "address"
          },
          {
            "internalType": "uint32",
            "name": "upazilaId",
            "type": "uint32"
          },
          {
            "internalType": "uint64",
            "name": "registeredAt",
            "type": "uint64"
          },
          {
            "internalType": "bool",
            "name": "revoked",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "onHold",
            "type": "bool"
          }
        ],
        "internalType": "struct VotingRegistry.Voter",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "getVoterUpazila",
    "outputs": [
      {
        "internalType": "uint32",
        "name": "",
        "type": "uint32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "grantRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "hasRole",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "trustee",
        "type": "address"
      }
    ],
    "name": "hasSubmittedShare",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "hasVoted",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "trustee",
        "type": "address"
      }
    ],
    "name": "isElectionTrustee",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "isRegisteredVoter",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      }
    ],
    "name": "isUpazila",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "openCandidateRegistration",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      }
    ],
    "name": "openVoting",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "uint256[]",
        "name": "totals",
        "type": "uint256[]"
      }
    ],
    "name": "publishResult",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "profileHash",
        "type": "bytes32"
      }
    ],
    "name": "registerCandidate",
    "outputs": [
      {
        "internalType": "uint32",
        "name": "candidateId",
        "type": "uint32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      },
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      }
    ],
    "name": "registerUpazila",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "uint32",
        "name": "upazilaId",
        "type": "uint32"
      }
    ],
    "name": "registerVoter",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "callerConfirmation",
        "type": "address"
      }
    ],
    "name": "renounceRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "revokeRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      }
    ],
    "name": "revokeVoter",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "uint32",
        "name": "candidateId",
        "type": "uint32"
      },
      {
        "internalType": "enum VotingRegistry.CandidateStatus",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "setCandidateStatus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "n",
        "type": "bytes"
      },
      {
        "internalType": "bytes",
        "name": "nSquared",
        "type": "bytes"
      }
    ],
    "name": "setElectionKey",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "address[]",
        "name": "trustees",
        "type": "address[]"
      },
      {
        "internalType": "uint8",
        "name": "threshold",
        "type": "uint8"
      }
    ],
    "name": "setElectionTrustees",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "onHold",
        "type": "bool"
      },
      {
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      }
    ],
    "name": "setVoterHold",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "electionId",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "share",
        "type": "bytes"
      }
    ],
    "name": "submitDecryptionShare",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes4",
        "name": "interfaceId",
        "type": "bytes4"
      }
    ],
    "name": "supportsInterface",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "voterCommitment",
        "type": "bytes32"
      },
      {
        "internalType": "uint32",
        "name": "newUpazilaId",
        "type": "uint32"
      }
    ],
    "name": "transferVoterArea",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "upazilaCount",
    "outputs": [
      {
        "internalType": "uint32",
        "name": "",
        "type": "uint32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "voterCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const
