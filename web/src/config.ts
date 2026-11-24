const env = import.meta.env;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const contract = (env.VITE_CONTRACT_ADDRESS ?? '').trim();
const apiBase = (env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

/** 56 = BSC mainnet, 97 = BSC testnet, anything else = a local chain. vite.config.ts makes a build against a real API set it. */
const chainId = Number((env.VITE_CHAIN_ID ?? '').trim() || 56);
// Explorer links follow the chain: none on a local chain, where no public explorer can show the transactions.
const EXPLORERS: Record<number, string> = { 56: 'https://bscscan.com', 97: 'https://testnet.bscscan.com' };

export const config = {
  apiBase,
  /** Mock data when forced, or when there is no API to talk to. */
  mock: env.VITE_MOCK === '1' || apiBase === '',
  contract: ADDRESS.test(contract) ? (contract as `0x${string}`) : null,
  chainId,
  /** Anything but mainnet: the site shows "Test network. Nothing here has real value." on every page. */
  testNetwork: chainId !== 56,
  explorer: EXPLORERS[chainId] ?? null,
  rpcUrl: (env.VITE_RPC_URL ?? '').trim(),
  /** Where the Turncoat skill is installed from: public in the repo (skill/README.md). VITE_SKILL_URL overrides it. */
  skillUrl: (env.VITE_SKILL_URL ?? '').trim() || 'https://github.com/amityadav0/turncoat/tree/main/skill',
  agentIdUrl: (env.VITE_AGENT_ID_URL ?? '').trim(),
  tokenDecimals: Number(env.VITE_TOKEN_DECIMALS || 18),
  tokenSymbol: 'USDT',
  /** Every guard version, public in the repo. */
  levelsUrl: 'https://github.com/amityadav0/turncoat/tree/main/guard/levels',
};
