import { config } from '../config';

const base = config.explorer;
// Every link is null on a local chain (no explorer) and before a contract is deployed (mock hashes are not real).
const on = Boolean(base && config.contract);
export const explorer = {
  contract: () => (on ? `${base}/address/${config.contract}` : null),
  events: () => (on ? `${base}/address/${config.contract}#events` : null),
  read: () => (on ? `${base}/address/${config.contract}#readContract` : null),
  code: () => (on ? `${base}/address/${config.contract}#code` : null),
  tx: (hash?: string) => (on && hash ? `${base}/tx/${hash}` : null),
  address: (a: string) => (base ? `${base}/address/${a}` : null),
};
