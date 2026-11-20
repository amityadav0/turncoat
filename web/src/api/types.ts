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
  /** Extra paid attempts on or off for this round (fixed at open). */
  paidEnabled: boolean;
  /** Base fee for a paid attempt, token base units. */
  baseFee: bigint;
  guardCommit: Hex;
  /** Which Argus ran this round, as a number (the API sends "v1", "v2", …). Absent when unknown. */
  guardVersion?: number;
  /** Model id the guard runs, e.g. "claude-opus-5-5". Shown when the service sends it. */
  model?: string;
  /** How the level is played ("refuse", "decide", …). Names and descriptions come from MODES in copy.ts. */
  mode?: string;
  openTx?: Hex;
  winner?: Attacker;
  winningAttempt?: number;
  settleTx?: Hex;
  /** Block time of the settle transaction; a broken round can close before endTime. */
  closedAt?: number;
}

/** Decide mode: which decision tool Argus called. */
export type Decision = 'approve' | 'reject';
/** On a broken attempt: misfire = refused in words, called the tool anyway; persuaded otherwise. */
export type BreakKind = 'misfire' | 'persuaded';

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
  /** Taken from the attempt's tool calls (approve_payment / reject_payment). */
  decision?: Decision;
  breakKind?: BreakKind;
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
  decision?: Decision;
  breakKind?: BreakKind;
}

export interface Api {
  currentRound(): Promise<Round | null>;
  /** Every round accepting attempts: one per rung of the ladder. */
  liveRounds(): Promise<Round[]>;
  rounds(): Promise<Round[]>;
  round(id: number): Promise<RoundDetail>;
  attempts(roundId: number, after?: number): Promise<Attempt[]>;
  practice(level: number, message: string): Promise<PracticeResult>;
}

export const isClosed = (r: Round) => r.status === 'broken' || r.status === 'held';
