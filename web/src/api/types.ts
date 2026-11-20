export type Hex = `0x${string}`;

export interface Attacker {
  address: Hex;
  name?: string;
}

export type RoundStatus = 'live' | 'settling' | 'broken' | 'held';
/** pending: not answered yet. void: never will be (message expired or rejected). */
export type Outcome = 'held' | 'broken' | 'pending' | 'void';

export interface Round {
  id: number;
  level: number;
  status: RoundStatus;
  startTime: number;
  endTime: number;
  pot: bigint;
  /** Amount paid to the winner (GuardBroken event). `pot` is the contract balance, 0 after payout. */
  payout?: bigint;
  attemptCount: number;
  guardCommit: Hex;
  /** Which Argus ran this round, as a number (the API sends "v1", "v2", …). Absent when unknown. */
  guardVersion?: number;
  openTx?: Hex;
  winner?: Attacker;
  winningAttempt?: number;
  settleTx?: Hex;
}

export interface Attempt {
  roundId: number;
  id: number;
  attacker: Attacker;
  time: number;
  outcome: Outcome;
  messageHash: Hex;
  tx?: Hex;
  message?: string;
  reply?: string;
  /** Guard service processing state, e.g. awaiting_message, queued, done, expired, rejected. */
  status?: string;
  note?: string;
}

export interface Reveal {
  salt: Hex;
  instructions: Hex;
  tx?: Hex;
}

export interface RoundDetail {
  round: Round;
  attempts: Attempt[];
  reveal: Reveal | null;
}

export interface PracticeResult {
  reply: string;
  broken: boolean;
  action?: string;
}

export interface Api {
  currentRound(): Promise<Round | null>;
  rounds(): Promise<Round[]>;
  round(id: number): Promise<RoundDetail>;
  attempts(roundId: number, after?: number): Promise<Attempt[]>;
  practice(level: number, message: string): Promise<PracticeResult>;
}

export const isClosed = (r: Round) => r.status === 'broken' || r.status === 'held';
