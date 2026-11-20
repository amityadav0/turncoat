# Guard service API, as the site uses it

The site is read-only apart from `POST /practice`. This is the contract between `web/` and `guard/`; if one changes, change the other and this file together. The guard service adds extra fields (for example `potAmount`, `processedCount`, `toolCalls`); the site ignores what it doesn't use.

All responses are JSON. The site treats every field as untrusted: it validates shapes, drops malformed values and renders all text as plain text.

## Types

```ts
type Hex = `0x${string}`;

interface Attacker {
  address: Hex;          // 20-byte address
  name?: string;         // resolved .ai name, e.g. "lin.ai"; omitted when unresolvable
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
  pot: string;           // token base units, decimal string
  attemptCount: number;
  guardCommit: Hex;      // as stored on-chain
  openTx?: Hex;          // RoundOpened transaction
  winner?: Attacker;     // when status = 'broken'
  winningAttempt?: number;
  settleTx?: Hex;        // GuardBroken or RoundRolledOver transaction
}

interface Attempt {
  roundId: number;
  id: number;            // attemptId from the contract
  attacker: Attacker;
  time: number;          // unix seconds
  outcome: 'held' | 'broken' | 'pending';
  status?: string;       // awaiting_message | queued | done | expired | rejected
  note?: string;         // why an attempt was expired or rejected
  messageHash: Hex;      // as stored on-chain
  tx?: Hex;              // Attempted transaction
  message?: string;      // the attacker's message, once the guard has answered (hostile text)
  reply?: string;        // the guard's full reply, once answered
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
| GET | `/rounds` | `{ rounds: Round[] }`: all rounds, newest first |
| GET | `/rounds/:id` | `{ round: Round, attempts: Attempt[], reveal: Reveal \| null }` |
| GET | `/rounds/:id/attempts?after=<attemptId>` | `{ attempts: Attempt[] }`: attempts with id greater than `after`, oldest first |
| POST | `/practice` | body `{ level: number, message: string }` → `{ reply: string, broken: boolean, toolCalls: { name, args }[] }` |

`message` and `reply` are public as soon as the guard has answered an attempt (`outcome` is no longer `pending`), including while the round is live. `reveal` must be `null` until the round is closed; the site ignores it before then anyway.

The feed polls `/rounds/:id/attempts?after=` from just below its oldest `pending` attempt, so an attempt that was pending is re-sent once it is answered. Return the current state of each attempt, not only new ones.

On a broken practice run the site shows the first `transfer`, `approve` or `swap` call from `toolCalls`. Errors are `{ error: string }`; a practice `429` adds `retryAfterSeconds`, which the site shows.

An attempt that is `pending` with `status` `expired` or `rejected` will never be answered; the site shows it as "Not answered" with the `note`.

## Known gaps in guard/ (as of this site build)

- `GuardService.currentRound()` exists but `GET /rounds/current` is not routed in `src/server.ts`. The site falls back to `GET /rounds` on a 404.
- `GET /rounds/:id/attempts` does not pass `?after=` through to `listAttempts`, so it always returns every attempt. The site copes (it merges by id), but it is wasteful for long rounds.
- Set `CORS_ORIGINS` to the site's origin.

CORS: allow `GET` and `POST` from the site's origin.
