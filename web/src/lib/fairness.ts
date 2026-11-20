import { concatHex, createPublicClient, hexToString, http, keccak256, type Hex } from 'viem';
import { config } from '../config';
import { copy } from '../content/copy';

/** Mirrors the contract: keccak256(abi.encodePacked(salt, instructions)). Runs in the visitor's browser. */
export const commitOf = (salt: Hex, instructions: Hex) => keccak256(concatHex([salt, instructions]));

export function instructionsText(instructions: Hex) {
  try {
    return hexToString(instructions);
  } catch {
    return copy.fairness.badUtf8;
  }
}

const getRoundAbi = [
  {
    type: 'function', name: 'getRound', stateMutability: 'view',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'level', type: 'uint8' }, { name: 'paidEnabled', type: 'bool' }, { name: 'closed', type: 'bool' },
        { name: 'startTime', type: 'uint64' }, { name: 'endTime', type: 'uint64' }, { name: 'baseFee', type: 'uint96' },
        { name: 'attemptCount', type: 'uint32' }, { name: 'winningAttempt', type: 'uint32' }, { name: 'winner', type: 'address' },
        { name: 'guardCommit', type: 'bytes32' }, { name: 'pot', type: 'uint256' },
      ],
    }],
  },
] as const;

export const canReadChain = Boolean(config.rpcUrl && config.contract);

/** Reads guardCommit straight from the contract, so the check doesn't depend on the guard service. */
export async function onChainCommit(roundId: number): Promise<Hex> {
  if (!canReadChain) throw new Error('No RPC configured');
  const client = createPublicClient({ transport: http(config.rpcUrl) });
  const r = await client.readContract({
    address: config.contract!, abi: getRoundAbi, functionName: 'getRound', args: [BigInt(roundId)],
  });
  return r.guardCommit;
}
