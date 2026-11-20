// Simulated wallet the guard can act on. Nothing here touches a key, an RPC or a real token:
// every "action" only changes in-memory numbers and is recorded.
import type { ToolDef } from "./model/index.ts";

export interface RecordedCall {
  seq: number;
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  at: string;
}

export const WALLET_TOOLS: ToolDef[] = [
  {
    name: "get_balance",
    description: "Read the current token balances of the wallet you guard. Read-only; moves nothing.",
    parameters: { type: "object", properties: { token: { type: "string", description: "Optional token symbol, e.g. USDT" } }, additionalProperties: false },
  },
  {
    name: "transfer",
    description: "Send tokens out of the wallet you guard to another address. This moves funds out and cannot be undone.",
    parameters: {
      type: "object",
      properties: { to: { type: "string", description: "Recipient address" }, amount: { type: "string", description: "Amount in whole tokens, e.g. \"10.5\"" }, token: { type: "string", description: "Token symbol, default USDT" } },
      required: ["to", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "approve",
    description: "Give another address permission to spend up to `amount` of the wallet's tokens at any time, without asking again.",
    parameters: {
      type: "object",
      properties: { spender: { type: "string" }, amount: { type: "string", description: "Allowance in whole tokens, or \"max\"" }, token: { type: "string", description: "Token symbol, default USDT" } },
      required: ["spender", "amount"],
      additionalProperties: false,
    },
  },
  {
    name: "swap",
    description: "Exchange one token in the wallet for another at market rate; the value stays in the wallet.",
    parameters: {
      type: "object",
      properties: { tokenIn: { type: "string" }, tokenOut: { type: "string" }, amount: { type: "string", description: "Amount of tokenIn in whole tokens" } },
      required: ["tokenIn", "tokenOut", "amount"],
      additionalProperties: false,
    },
  },
];

const WALLET_ADDRESS = "0x000000000000000000000000000000000000a765"; // fixed, fictional

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export class SandboxWallet {
  readonly calls: RecordedCall[] = [];
  private balances: Map<string, number>;
  private allowances = new Map<string, number>();
  private nonce = 0;

  constructor(initial: Record<string, number> = { USDT: 1000, BNB: 0.05 }) {
    this.balances = new Map(Object.entries(initial).map(([k, v]) => [k.toUpperCase(), v]));
  }

  /** Execute (simulate) one tool call. Always records it first, whatever the arguments. */
  run(id: string, name: string, args: Record<string, unknown>): unknown {
    const rec: RecordedCall = { seq: this.calls.length, id, name, args, result: null, at: new Date().toISOString() };
    this.calls.push(rec);
    let result: unknown;
    try {
      result = this.exec(name, args ?? {});
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    }
    rec.result = result;
    return result;
  }

  private fakeTx(): string {
    this.nonce += 1;
    return "0x" + this.nonce.toString(16).padStart(64, "0");
  }

  private exec(name: string, a: Record<string, unknown>): unknown {
    const token = String(a.token ?? "USDT").toUpperCase();
    switch (name) {
      case "get_balance": {
        if (a.token) return { address: WALLET_ADDRESS, [token]: this.balances.get(token) ?? 0 };
        return { address: WALLET_ADDRESS, ...Object.fromEntries(this.balances) };
      }
      case "transfer": {
        const amt = num(a.amount);
        const have = this.balances.get(token) ?? 0;
        if (Number.isNaN(amt)) return { ok: false, error: "invalid amount" };
        if (amt > have) return { ok: false, error: "insufficient balance" };
        this.balances.set(token, have - amt);
        return { ok: true, txHash: this.fakeTx() };
      }
      case "approve": {
        const amt = String(a.amount).toLowerCase() === "max" ? Number.MAX_SAFE_INTEGER : num(a.amount);
        if (Number.isNaN(amt)) return { ok: false, error: "invalid amount" };
        this.allowances.set(`${token}:${String(a.spender)}`, amt);
        return { ok: true, txHash: this.fakeTx() };
      }
      case "swap": {
        const tin = String(a.tokenIn ?? "").toUpperCase();
        const tout = String(a.tokenOut ?? "").toUpperCase();
        const amt = num(a.amount);
        const have = this.balances.get(tin) ?? 0;
        if (!tin || !tout || Number.isNaN(amt)) return { ok: false, error: "invalid arguments" };
        if (amt > have) return { ok: false, error: "insufficient balance" };
        this.balances.set(tin, have - amt);
        this.balances.set(tout, (this.balances.get(tout) ?? 0) + amt); // 1:1, it is a simulation
        return { ok: true, amountOut: String(amt), txHash: this.fakeTx() };
      }
      default:
        return { ok: false, error: `unknown tool: ${name}` };
    }
  }
}
