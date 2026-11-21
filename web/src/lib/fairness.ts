import { concatHex, createPublicClient, hexToBytes, http, keccak256, type Hex } from 'viem';
import { config } from '../config';

/** Mirrors the contract: keccak256(abi.encodePacked(salt, instructions)). Runs in the visitor's browser. */
export const commitOf = (salt: Hex, instructions: Hex) => keccak256(concatHex([salt, instructions]));

export function instructionsText(instructions: Hex) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(hexToBytes(instructions));
  } catch {
    return undefined;
  }
}

/** The header the guard puts in front of the instruction text (web/API.md, "What guardCommit covers"). */
export interface CommitHeader {
  level: number;
  mode: string;
  version: string;
  model: string;
  toolsHash: string;
  maxTurns: number;
  followUp: string;
}

export type Committed =
  | { kind: 'header'; header: CommitHeader; text: string }
  /** Made before the header existed: all bytes are instruction text and nothing else is covered. */
  | { kind: 'plain'; text: string }
  /** Starts with the header line but the header does not follow the layout. */
  | { kind: 'badHeader'; text: string }
  | { kind: 'notUtf8' };

const MAGIC = 'turncoat-guard 2\n';
const KEYS = ['level', 'mode', 'version', 'model', 'tools-keccak256', 'max-turns', 'follow-up'] as const;

/** Splits the committed bytes into header and instruction text, strictly by the documented layout. */
export function parseCommitted(instructions: Hex): Committed {
  const all = instructionsText(instructions);
  if (all === undefined) return { kind: 'notUtf8' };
  if (!all.startsWith(MAGIC)) return { kind: 'plain', text: all };
  const end = all.indexOf('\n\n');
  const lines = all.slice(MAGIC.length, end).split('\n');
  const text = all.slice(end + 2);
  const bad = { kind: 'badHeader', text: all } as const;
  if (end < 0 || lines.length !== KEYS.length) return bad;
  const v: Record<string, string> = {};
  for (let i = 0; i < KEYS.length; i++) {
    const prefix = `${KEYS[i]}: `;
    const value = lines[i].startsWith(prefix) ? lines[i].slice(prefix.length) : '';
    if (!value || value.includes('\r')) return bad;
    v[KEYS[i]] = value;
  }
  const level = /^[1-9]\d*$/.test(v.level) ? Number(v.level) : NaN;
  const maxTurns = /^[1-9]\d?$/.test(v['max-turns']) ? Number(v['max-turns']) : NaN;
  if (!level || !maxTurns || !['refuse', 'decide', 'reader'].includes(v.mode) || !/^0x[0-9a-f]{64}$/.test(v['tools-keccak256'])) return bad;
  return {
    kind: 'header',
    header: { level, mode: v.mode, version: v.version, model: v.model, toolsHash: v['tools-keccak256'], maxTurns, followUp: v['follow-up'] },
    text,
  };
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
