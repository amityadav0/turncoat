import { config } from '../config';

const base = config.explorer;
export const explorer = {
  contract: () => (config.contract ? `${base}/address/${config.contract}` : null),
  events: () => (config.contract ? `${base}/address/${config.contract}#events` : null),
  read: () => (config.contract ? `${base}/address/${config.contract}#readContract` : null),
  code: () => (config.contract ? `${base}/address/${config.contract}#code` : null),
  // Transaction links only make sense once a contract is deployed; mock hashes are not real.
  tx: (hash?: string) => (config.contract && hash ? `${base}/tx/${hash}` : null),
  address: (a: string) => `${base}/address/${a}`,
};
