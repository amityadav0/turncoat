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
  /** The round's signer (roundSigner on-chain): the only key whose verdict can pay this pot. */
  signer?: Hex;
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
  /** Hidden by the operator: message and reply are never shown, only the on-chain hash. */
  hidden?: boolean;
  /** Taken from the attempt's tool calls (approve_payment / reject_payment). */
  decision?: Decision;
  breakKind?: BreakKind;
  /** Guard service processing state, e.g. awaiting_message, queued, done, expired, rejected, failed. */
  status?: string;
  note?: string;
}

export interface Reveal {
  salt: Hex;
  instructions: Hex;
  tx?: Hex;
  /** chain: a GuardRevealed transaction was recorded; service: from the guard service's own commit record. Absent from older services. */
  source?: 'chain' | 'service';
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
  /** Which guard answered (G-028): the rung's committed model and version. Absent from older services. */
  model?: string;
  guardVersion?: number;
  rung?: Rung;
}

/** GET /attackers/:address: the on-chain tester record and every attempt this wallet made. */
export interface AttackerRecord {
  attacker: Attacker;
  attempts: number;
  breaks: number;
  history: { roundId: number; attemptId: number; time: number; paid: boolean; status: string; broken?: boolean }[];
}

/** A rung of the ladder: the lighter round's model and version, or the top round's. */
export type Rung = 'lighter' | 'top';

/** One practice rung the service offers (GET /practice/rungs). */
export interface PracticeRung {
  rung: Rung;
  model?: string;
  guardVersion?: number;
}

export interface Api {
  currentRound(): Promise<Round | null>;
  /** Every round accepting attempts: one per rung of the ladder. */
  liveRounds(): Promise<Round[]>;
  rounds(): Promise<Round[]>;
  round(id: number): Promise<RoundDetail>;
  attempts(roundId: number, after?: number): Promise<Attempt[]>;
  practice(level: number, message: string, rung?: Rung): Promise<PracticeResult>;
  /** The rungs practice can run; null when the service does not say (older service). */
  practiceRungs(): Promise<PracticeRung[] | null>;
  attacker(address: string): Promise<AttackerRecord>;
}

export const isClosed = (r: Round) => r.status === 'broken' || r.status === 'held';
