// Attacker .ai names from the Agent ID registry, cached in SQLite. Handles are soulbound, so a found
// name is kept for good; "no name" is re-checked after `missTtlMs`. Lookups never fail a request.
import type { Store } from "./db.ts";

export type NameLookup = (address: `0x${string}`) => Promise<string | null>;

export class AttackerNames {
  constructor(private store: Store, private lookup: NameLookup, private missTtlMs = 3_600_000, private now = () => Date.now()) {}

  /** Names for these addresses (lowercase keys); addresses without a name are absent. */
  async resolve(addresses: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const todo: string[] = [];
    for (const a of new Set(addresses.map((x) => x.toLowerCase()))) {
      const c = this.store.attackerName(a);
      if (c?.name) out.set(a, c.name);
      else if (!c || this.now() - c.checked_at >= this.missTtlMs) todo.push(a);
    }
    await Promise.all(todo.map(async (a) => {
      try {
        const name = await this.lookup(a as `0x${string}`);
        this.store.putAttackerName(a, name, this.now());
        if (name) out.set(a, name);
      } catch {
        /* RPC trouble: try again next time, show the address meanwhile */
      }
    }));
    return out;
  }
}
