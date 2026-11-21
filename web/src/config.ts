const env = import.meta.env;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const contract = (env.VITE_CONTRACT_ADDRESS ?? '').trim();
const apiBase = (env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export const config = {
  apiBase,
  /** Mock data when forced, or when there is no API to talk to. */
  mock: env.VITE_MOCK === '1' || apiBase === '',
  contract: ADDRESS.test(contract) ? (contract as `0x${string}`) : null,
  explorer: (env.VITE_EXPLORER_URL || 'https://bscscan.com').replace(/\/+$/, ''),
  rpcUrl: (env.VITE_RPC_URL ?? '').trim(),
  skillUrl: (env.VITE_SKILL_URL ?? '').trim(),
  agentIdUrl: (env.VITE_AGENT_ID_URL ?? '').trim(),
  tokenDecimals: Number(env.VITE_TOKEN_DECIMALS || 18),
  tokenSymbol: 'USDT',
  /** Every guard version, public in the repo. */
  levelsUrl: 'https://github.com/amityadav0/turncoat/tree/main/guard/levels',
};
