// Operator only, run on the guard server: hide one attempt's text from the public API.
//   npm run hide -- --round N --attempt M --reason "doxxing"     hide
//   npm run hide -- --round N --attempt M --unhide                show it again
//   npm run hide -- --list                                        list hidden attempts
// A hidden attempt keeps its outcome, decision, on-chain messageHash, tx and verdict; its message,
// reply, tool calls and conversation are omitted and it shows `hidden: true`. The reason is stored for
// the operator and never served. There is deliberately no HTTP route for this. Takes effect within a
// few seconds (READ_CACHE_MS). Reads DB_PATH from env or guard/.env.
// In Docker: docker compose exec guard npm run hide -- --round 1 --attempt 7 --reason "scam link"
import fs from "node:fs";
import path from "node:path";
import { GUARD_ROOT, loadGuardEnv } from "../src/config.ts";
import { Store } from "../src/db.ts";

loadGuardEnv();
const args = process.argv.slice(2);
const has = (n: string) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const flag = (n: string) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const fail = (m: string) => { console.error(m); process.exit(2); };

const list = has("--list");
const unhide = has("--unhide");
const round = flag("--round");
const attempt = flag("--attempt");
const reason = flag("--reason");
if (args.length) fail(`unexpected arguments: ${args.join(" ")}`);
const store = new Store(path.resolve(GUARD_ROOT, process.env.DB_PATH || "data/guard.sqlite"));
try {
  if (list) {
    const rows = store.hiddenAttempts();
    if (!rows.length) console.log("no hidden attempts");
    for (const r of rows) console.log(`round ${r.round_id} attempt ${r.attempt_id}  hidden ${r.hidden_at}  reason: ${r.reason}`);
  } else {
    const id = (v: string | undefined, n: string) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : fail(`--${n} must be a non-negative integer`)) as number;
    const r = id(round, "round"), a = id(attempt, "attempt");
    if (unhide) {
      console.log(store.unhideAttempt(r, a) ? `round ${r} attempt ${a} is visible again` : `round ${r} attempt ${a} was not hidden`);
    } else {
      if (!reason?.trim()) fail('--reason "…" is required (kept for the operator, never served)');
      store.hideAttempt(r, a, reason!.trim().slice(0, 500));
      console.log(`round ${r} attempt ${a} hidden: the API now omits its message, reply, tool calls and conversation`);
    }
  }
} finally {
  store.close();
}
