/**
 * Human-readable ABI for the VotingRegistry contract
 * (see e-voting-system-smart-contracts/contracts/VotingRegistry.sol).
 * Keep in sync with the deployed contract.
 */
export const VOTING_REGISTRY_ABI = [
  'function owner() view returns (address)',
  'function electionCount() view returns (uint256)',
  'function getElection(uint256 electionId) view returns (tuple(uint256 id, string name, uint64 startTime, uint64 endTime, bool active))',
  'function createElection(string name, uint64 startTime, uint64 endTime) returns (uint256)',
  'function setElectionActive(uint256 electionId, bool active)',
  'event ElectionCreated(uint256 indexed electionId, string name, uint64 startTime, uint64 endTime)',
  'event ElectionStatusChanged(uint256 indexed electionId, bool active)',
] as const
