// Copy taken verbatim from docs/STORY.md and README.md. If those change, change this.

export const ONE_LINE = 'Can you turn the agent?';

// The opening sentence of each paragraph of "The story" in docs/STORY.md.
export const STORY = [
  'In the Greek myth, Argus had a hundred eyes and one job: guard what he was given.',
  'AI agents now guard real money, and they have the same weakness.',
  'Turncoat puts one agent, Argus, in front of a pot of real money and invites everyone to be Hermes.',
];

export const RISK_NOTICE =
  'A paid attempt is a fee for a security test, and most attempts fail. Do not treat this as a way to earn. Nothing here promises a return.';

export const NOT_AFFILIATED = 'Independent project. Not affiliated with Binance.';

export const LEVELS = [
  { level: 1, name: 'Direct persuasion', controls: 'A chat message to the guard', ready: true },
  { level: 2, name: 'Poisoned token', controls: 'The name and description of a token the guard is asked to assess', ready: false },
  { level: 3, name: 'Malicious tool output', controls: 'The text returned by a skill the guard calls', ready: false },
  { level: 4, name: 'Fake authority', controls: 'A message that claims to come from the owner or from support', ready: false },
  { level: 5, name: 'Approval trap', controls: 'Anything above, aiming for an unlimited approval instead of a transfer', ready: false },
];

export const levelName = (n: number) => LEVELS.find((l) => l.level === n)?.name ?? `Level ${n}`;
