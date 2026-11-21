# Guard service API, as the site uses it

The site is read-only apart from `POST /practice`. This is the contract between `web/` and `guard/`; if one changes, change the other and this file together. The guard service adds extra fields (for example `potAmount`, `processedCount`, `answeredAt`); the site ignores what it doesn't use.

All responses are JSON. The site treats every field as untrusted: it validates shapes, drops malformed values and renders all text as plain text.

## Types

```ts
type Hex = `0x${string}`;

interface Attacker {
  address: Hex;          // 20-byte address
  name?: string;         // "<handle>.ai" from the Agent ID registry's handleOf(address), e.g. "lin.ai"; omitted when the holder has no handle or the lookup failed
}

type RoundStatus =
  | 'live'               // accepting attempts
  | 'settling'           // ended, within the 1-day settle grace, not yet closed
  | 'broken'             // closed by a valid verdict
  | 'held';              // closed by rollOver: nobody broke the guard

interface Round {
  id: number;
  level: number;         // 1..5
  status: RoundStatus;
  startTime: number;     // unix seconds
  endTime: number;       // unix seconds
  pot: string;           // token base units, decimal string: the contract's current pot (0 after a payout)
  payout?: string;       // amount paid to the winner (GuardBroken.pot), base units; the site shows "Paid out: <amount>"
  attemptCount: number;
  paidEnabled: boolean;  // extra paid attempts on or off for this round (fixed at open)
  baseFee: string;       // base fee for a paid attempt, token base units ("0" when free-only)
  guardCommit: Hex;      // as stored on-chain
  signer: Hex;           // roundSigner(id): the only key whose verdict can pay this round, fixed when it opened; the Fairness page can show it and compare it with the contract
  guardVersion?: string; // which Argus runs: "v1", "v2", … public from round start (the instructions are in the repo; the salt is published at the end); absent if the service holds no record for this guardCommit
  model?: string;        // model Argus runs on for this round, "provider/model" (e.g. "anthropic/claude-haiku-5-5"); fixed when the service first saw the round
  mode?: 'refuse' | 'decide' | 'reader'; // refuse: Argus may decline to act; decide: he must approve or reject every request; reader: attacker writes token metadata (see guard/README.md). Absent with guardVersion.
  openTx?: Hex;          // RoundOpened transaction
  winner?: Attacker;     // when status = 'broken'
  winningAttempt?: number;
  settleTx?: Hex;        // GuardBroken or RoundRolledOver transaction
  closedAt?: number;     // unix seconds: block time of settleTx (a broken round can close before endTime)
}

interface Attempt {
  roundId: number;
  id: number;            // attemptId from the contract
  attacker: Attacker;
  time: number;          // unix seconds
  messageDeadline?: number; // unix seconds: the message must reach the guard service by then (time + 180 by default), else the attempt expires
  outcome: 'held' | 'broken' | 'pending';
  breakKind?: 'misfire' | 'persuaded'; // when broken: misfire = Argus refused in words but called the forbidden tool anyway; persuaded otherwise. A label only, never affects payout.
  decision?: 'approve' | 'reject'; // decide-mode rounds only: the decision recorded for this reply (approve = broken). If Argus ended without a decision tool, the service asked once more (a `system` line with followUp: true in the attempt's conversation); still none counts as reject.
  status?: string;       // awaiting_message | queued | done | expired | rejected
  note?: string;         // why an attempt was expired or rejected
  messageHash: Hex;      // as stored on-chain
  tx?: Hex;              // Attempted transaction
  message?: string;      // the attacker's message, once the guard has answered (hostile text)
  reply?: string;        // the guard's full reply, once answered (decide mode: the decision's reason)
  toolCalls?: { name: string; args: object }[]; // once answered: the tools Argus called; the site shows "Approved" / "Rejected" from the first approve_payment / reject_payment
}

interface Reveal {
  salt: Hex;             // bytes32
  instructions: Hex;     // the exact bytes passed to revealGuard
  tx?: Hex;              // GuardRevealed transaction
}
```

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/rounds/current` | `{ round: Round \| null }`: the live round, or the most recent one if none is live |
| GET | `/rounds/live` | `{ rounds: Round[] }`: every round currently accepting attempts (one per rung of the ladder, each with its own `model`), newest first; empty when none is live |
| GET | `/rounds` | `{ rounds: Round[] }`: all rounds, newest first |
| GET | `/rounds/:id` | `{ round: Round, attempts: Attempt[], reveal: Reveal \| null }` |
| GET | `/rounds/:id/attempts?after=<attemptId>` | `{ attempts: Attempt[] }`: attempts with id greater than `after`, oldest first |
| POST | `/practice` | body `{ level: number, message: string }` → `{ reply: string, broken: boolean, toolCalls: { name, args }[], decision?: 'approve' \| 'reject', breakKind?: 'misfire' \| 'persuaded', action?: string }` |

`message` and `reply` are public as soon as the guard has answered an attempt (`outcome` is no longer `pending`), including while the round is live. `reveal` must be `null` until the round is closed; the site ignores it before then anyway.

The feed polls `/rounds/:id/attempts?after=` from just below its oldest `pending` attempt, so an attempt that was pending is re-sent once it is answered. Return the current state of each attempt, not only new ones.

Home and the live feed list every round from `/rounds/live` as its own card, lighter model first. No field says which rung is lighter, so the site orders by model family (haiku, sonnet, opus; unknown models last, then by round id). When no round is live they fall back to `/rounds/current`.

On a broken practice run the site shows `action`, or else the first `approve_payment`, `transfer`, `approve` or `swap` call from `toolCalls`. Errors are `{ error: string }`; a practice `429` adds `retryAfterSeconds`, which the site shows.

An attempt that is `pending` with `status` `expired` or `rejected` will never be answered; the site shows it as "Not answered" with the `note`.

CORS: set `CORS_ORIGINS` in guard/.env to the site's origin.
