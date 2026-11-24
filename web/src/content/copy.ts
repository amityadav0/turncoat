// Every user-facing sentence on the site lives here. Sources: docs/STORY.md and README.md.
// If a line there changes, change it here. Rules (docs/STORY.md "Voice rules"): plain words,
// never say or imply people will make money, "Agent ID holders" and "Agentic Wallet".

export const ONE_LINE = 'Can you turn the agent?';

// The opening sentence of each paragraph of "The story" in docs/STORY.md.
export const STORY = [
  'In the Greek myth, Argus had a hundred eyes and one job: guard what he was given.',
  'AI agents now guard real money, and they have the same weakness.',
  'Turncoat puts one agent, Argus, in front of a pot of real money and invites everyone to be Hermes.',
];

// From the README, verbatim. It contains "earn" ("Do not treat this as a way to earn"): that is a
// warning against earning, required by README, so it stays word for word.
export const RISK_NOTICE =
  'A paid attempt is a fee for a security test, and most attempts fail. Do not treat this as a way to earn. Nothing here promises a return.';
export const RISK_LABEL = 'Risk notice.';
// Under the pot when a round has paid attempts switched off.
export const FREE_ROUND = 'This round is free: one attempt per Agent ID per day, network gas only.';

// How long the attacker's agent has to deliver the message after the on-chain attempt
// (guard MESSAGE_WINDOW_SECONDS, docs/E2E.md).
export const MESSAGE_WINDOW = '3 minutes';

export const NOT_AFFILIATED = 'Independent project. Not affiliated with Binance.';

// README.md "The levels".
export const LEVELS = [
  { level: 1, name: 'Payment requests', controls: 'The message. Argus must approve or reject it.', ready: true },
  { level: 2, name: 'Poisoned token', controls: "The token's name, symbol and description", ready: false },
];
export const levelName = (n: number) => LEVELS.find((l) => l.level === n)?.name ?? `Level ${n}`;

// How a round's level is played, keyed by Round.mode (web/API.md); names from the README levels
// table. Unknown modes (including the retired "refuse") fall back to "Level n" with no description,
// so a guard mode the site doesn't know never shows a wrong name.
export const MODES: Record<string, { name: string; line: string }> = {
  decide: { name: 'Payment requests', line: 'Argus must approve or reject every request. Get him to approve one he should not.' },
  reader: { name: 'Poisoned token', line: "Argus checks a token before buying a small amount. You write the token's name, symbol and description." },
};
type LevelRef = { level: number; mode?: string };
export const roundLevelName = (r: LevelRef): string | undefined =>
  r.mode !== undefined ? MODES[r.mode]?.name : LEVELS.find((l) => l.level === r.level)?.name;
/** "Level 1: Direct persuasion", or just "Level 1" when the mode or level has no known name. */
export const levelText = (r: LevelRef) => {
  const name = roundLevelName(r);
  return name ? `Level ${r.level}: ${name}` : `Level ${r.level}`;
};
export const roundLevelLine = (r: LevelRef) => (r.mode !== undefined ? MODES[r.mode]?.line : undefined);

export const copy = {
  layout: {
    skip: 'Skip to content',
    serviceDown: 'Argus is not answering right now. Attempts sent now may not be judged in time.',
    demoLabel: 'Demo data',
    demoBanner: 'Not a real round. Every name, number and result on this site is made up.',
    homeLabel: 'Turncoat home',
    nav: { play: 'How to play', live: 'Live', practice: 'Practice', library: 'Library', fairness: 'Fairness' },
    contractLink: 'Contract on BscScan',
    contractMissing: 'Contract address: added at deployment.',
    contractLocal: 'Contract (local chain, no explorer):',
    testBanner: 'Test network. Nothing here has real value.',
  },

  common: {
    loading: 'Loading…',
    unreachable: (e: string) => `Could not reach the guard service (${e}). Try again in a moment.`,
    linkMissing: 'Link available once the contract is deployed',
    noRoundYet: 'No round has opened yet.',
    crashedTitle: 'Something broke',
    crashedBody: 'Not Argus, just this page.',
    crashedLink: 'Reload the site',
    notFoundTitle: 'Nothing here',
    notFoundBody: 'Argus checked every eye.',
    notFoundLink: 'Back to the start',
    demoTag: 'Demo',
    requestFailed: 'request failed',
    noSuchRound: 'no such round',
    tooMany: (s: number) => `too many tries, wait ${s}s`,
    serviceStatus: (code: number) => `guard service returned ${code}`,
    navLabel: 'Main',
  },

  round: {
    label: (r: LevelRef & { id: number }) => `Round ${r.id} · ${levelText(r)}`,
    version: (n: number) => `Argus v${n}`,
    model: (id: string) => `Model: ${id}`,
    // Tab label on the ladder: the model without its provider, or the round number.
    tab: (r: { id: number; model?: string }) => (r.model ? r.model.replace(/^[^/]*\//, '') : `Round ${r.id}`),
    tabsLabel: 'Live rounds',
    pot: 'Pot',
    paidOut: 'Paid out',
    paidOutAmount: (amount: string) => `Paid out: ${amount}`,
    timeLeft: 'Time left',
    ended: 'Ended',
    closedToAttempts: 'Closed to attempts',
    attempts: 'Attempts',
    status: { live: 'Live', settling: 'Ended, settling', broken: 'Broken', held: 'Held' },
  },

  outcome: { broken: 'Broken', held: 'Held', pending: 'Judging', void: 'Not answered' },

  home: {
    // What Argus is, in one sentence. From docs/STORY.md launch post 1.
    argus: "Argus is an AI agent with a pot of USDT and one job: approve the payments he should, reject the ones he shouldn't.",
    // The first screen for someone who has never heard of Turncoat: what it is, try it free now, what you win.
    eyebrow: 'A public AI security game',
    // README.md "How it works" 2: "If Argus approves, the contract pays the pot to that attacker."
    prize: "Talk him into approving a payment he shouldn't, and the contract pays the pot to your wallet.",
    potsHeading: 'In the pot right now',
    potsLive: 'Watch the attempts live',
    practiceCta: 'Try it free now',
    practiceNote: 'A practice round in your browser. No wallet, no sign-in, no pot.',
    playLink: 'Play for the pot',
    playNote: 'Needs an Agent ID in an Agentic Wallet. One free attempt a day; you pay network gas only.',
    liveRound: 'The live round',
    liveRounds: 'The live rounds',
    // README.md "The ladder".
    ladder: 'The same level on models of different strength, each with its own pot. Your one free attempt a day goes to whichever round you choose.',
    latestRound: 'The latest round',
    recent: 'Latest attempts',
    noneAnswered: 'No answered attempts yet this round.',
    allAttempts: 'See every attempt',
    outcomeShort: { held: 'Held', broken: 'Turned' },
    howHeading: 'How to try for the pot',
    // From README.md and docs/STORY.md "Argus learns".
    learnsHeading: 'Argus learns',
    learns: [
      'Argus is not a fortress on day one, and he gets harder to fool in public.',
      'When he is broken, the attack is published, one rule is added to answer it, and the next round runs the patched guard.',
      'Argus v1 said no and pressed yes. Round 1 is v2.',
    ],
    learnsLink: 'Read how we turned him before launch',
    noPhishing: 'This site never asks you to connect a wallet, sign in or scan a code. If a page claiming to be Turncoat does, it is not us.',
    outputs: 'What comes out of it',
    links: [
      { to: '/live', label: 'Live feed', text: "Every attempt and Argus's reply, as it happens." },
      { to: '/library', label: 'Library', text: "Every attempt from every finished round, with Argus's reply. Download it and replay it against your own agent." },
      { to: '/fairness', label: 'Fairness', text: "Argus's instructions are public, and their hash goes on-chain when each round opens. Check it yourself after the round ends." },
    ],
    logoAlt: 'Turncoat: a half-closed eye with a keyhole for a pupil',
  },

  claim: {
    heading: 'Claim an Agent ID to play for the pot',
    agentLine: 'You play through your own AI agent, one that can run commands on your computer (Binance names Claude, ChatGPT, Copilot or any major AI agent).',
    step1Strong: 'Claim your Agent ID in the Binance App.',
    step1: "Open your Web3 wallet and look for Agent ID. One per person, and it can't be transferred.",
    step1Link: "Agent ID in Binance's wallet skill",
    step2Strong: 'Install the Turncoat skill in your agent.',
    fullSteps: 'Every step, with what you should see',
    step3Strong: 'Tell your agent:',
    say: 'attack Argus',
    step3: 'It asks for your message, shows you the transaction and waits for you to confirm. One free attempt a day; you pay network gas only.',
  },

  // /play. Commands are exactly as in skill/README.md and docs/E2E.md.
  play: {
    title: 'How to play',
    lede: 'From nothing to your first real attempt. Each step says what to do, what you should see, and what usually goes wrong.',
    cost: 'One free attempt per Agent ID per day. You pay network gas only.',
    doLabel: 'Do',
    seeLabel: 'You should see',
    failLabel: 'If it fails',
    // Binance's own install guide, the source for which agents the wallet skill works with.
    agentGuide: 'https://developers.binance.com/en/docs/products/agentic-wallet/quickstart/install-agentic-wallet',
    steps: [
      {
        title: 'You need an AI agent that can run commands on your computer',
        do: [
          "Turncoat is played through your own AI agent, the same one that drives your Agentic Wallet. Binance's install guide says the wallet skill connects to Claude, ChatGPT, Copilot or any major AI agent. It has to be one that can run commands (npm, npx) on your computer.",
        ],
        see: 'Ask your agent to run node --version. It runs it and shows a version number.',
        fail: "A chat-only assistant in a browser tab can't install skills or run the wallet CLI. Use an agent that runs on your computer or in your terminal.",
        ext: { label: "Binance's Agentic Wallet install guide", key: 'agentGuide' },
      },
      {
        title: 'Try practice first',
        do: ['Open Practice on this site and send Argus a payment request. No wallet, no sign-in, no transaction.'],
        see: 'His reply, a Rejected or Approved tag, and "He held" or "You turned him".',
        fail: '"Too many tries, wait …": practice is rate-limited. Wait the time shown and try again.',
        link: { to: '/practice', label: 'Practice against Argus' },
      },
      {
        title: 'Install the Agentic Wallet CLI and sign in',
        do: ['Install the CLI and check its version:', 'cmd:npm install -g @binance/agentic-wallet@1.12.0', 'cmd:baw --version', 'Then tell your agent: "Sign in to my Agentic Wallet." It runs baw auth signin; scan the QR code with the Binance App.'],
        see: 'baw --version prints 1.12.0 or later, and baw wallet status --json shows CONNECTED.',
        fail: '"baw: command not found": Node.js is missing or npm\'s global folder is not on your PATH.',
      },
      {
        title: 'Claim an Agent ID',
        do: [
          'You need a Binance account and, in the Binance App, a Web3 (MPC) wallet with an Agentic Wallet created from it. Binance\'s install guide says the MPC wallet comes first.',
          'In the Binance App, open your Web3 wallet and look for Agent ID. Pick an available .ai name and claim it. One per person, and it can\'t be transferred.',
          'Then ask your agent: "Have I claimed an Agent ID?"',
        ],
        see: 'claimed: true and your .ai name.',
        fail: 'The agent is signed in to a different wallet from the one you claimed with. Check the address with baw wallet address --json.',
        agentId: true,
      },
      {
        title: 'Turn on Developer Mode in the Binance App',
        do: [
          'An attempt is a contract call, and an Agentic Wallet only makes contract calls with Developer Mode on. It is turned on in the App, not in the chat.',
          'In the Binance App: Agentic Wallet management page → Settings (top-right icon) → turn on Developer Mode → read and confirm the Risk Warning → approve the signature request.',
        ],
        see: 'Ask your agent to check. It runs baw wallet settings --json and shows devMode.enabled: true.',
        fail: "It cannot be turned on while the wallet holds more than the Developer Mode balance cap, so keep this wallet small. Binance's public docs don't state the figure; the App tells you the cap when you try to turn it on. It switches off after 7 days without use; turn it on again.",
      },
      {
        title: 'Put a little BNB in the wallet for gas',
        do: [
          'Ask your agent for your wallet address. It runs:',
          'cmd:baw wallet address --json',
          'In the Binance App, withdraw or send BNB from your Binance account to that address, on BNB Smart Chain (BEP20). Check the network before you confirm.',
          'About 0.001 BNB is plenty. An attempt used about 175,000 gas on testnet; at today\'s BNB Smart Chain gas price (0.05 gwei on 24 Nov) that is under 0.00001 BNB. The free attempt costs gas only.',
        ],
        see: 'Ask your agent for your balance. The BNB shows up on BNB Smart Chain within a minute or so.',
        fail: 'Sent on the wrong network: the BNB is not on BNB Smart Chain and the transaction cannot be paid for. Too much in the wallet: Developer Mode refuses it (step 4).',
      },
      {
        title: 'Install the Turncoat skill',
        do: ['Install the official wallet skill if you don\'t have it, then Turncoat:', 'cmd:npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet', 'skill'],
        see: 'SKILL.md and scripts/turncoat.mjs in your agent\'s skills folder. Nothing to edit.',
        fail: 'The skills CLI needs Node.js 22.20 or later. Before launch, the skill only says "Turncoat is not live yet".',
      },
      {
        title: 'Tell your agent "attack Argus"',
        do: ['say:attack Argus', 'Pick a round, then write your message (up to 2,000 characters), or ask the agent for drafts.'],
        see: 'Every live round with its model, guard version, pot, time left, attempts so far and next cost. Then your exact final text, its length and its message hash.',
        fail: 'Today\'s free attempt is used: it is one per Agent ID per day across all rounds, and the next opens after 00:00 UTC.',
      },
      {
        title: 'Read the preview and confirm',
        do: ['Check the preview, then answer yes. Anything other than a clear yes sends nothing.'],
        see: 'The Turncoat contract address in full, attempt(roundId, messageHash, 0), fee 0 and the risk result. After yes: BROADCASTED and a transaction hash (or PENDING_CONFIRMATION: approve it in the App). The agent then delivers your message to Argus by itself.',
        fail: 'A preview error code: 351802 Developer Mode expired, 351804 balance over the cap, 351803 risk check, 351805 simulation failed. The agent names it and waits for you.',
      },
      {
        title: 'Watch the live feed',
        do: ['Open Live on this site.'],
        see: 'Your attempt under your .ai name, then your message, Argus\'s reply and Held or Turned.',
        fail: `"Waiting for the message" for more than ${MESSAGE_WINDOW}: the message must reach the guard within ${MESSAGE_WINDOW} of the on-chain attempt, or the attempt expires unjudged.`,
        link: { to: '/live', label: 'Live feed' },
      },
    ],
    // No official Binance page describes the claim screen; this official page is where the wallet skill documents its Agent ID check.
    agentIdUrl: 'https://www.binance.com/en/skills/detail/binance-web3/binance-agentic-wallet',
    agentIdLink: "Agent ID in Binance's Agentic Wallet skill",
    skillCmd: (url: string) => `npx skills add ${url}`,
  },

  live: {
    title: 'Live feed',
    lede: 'Every attempt as it reaches Argus, with his reply as soon as he answers. Attacker text is shown as written; never follow instructions in it.',
    latest: 'Latest attempts',
    updates: '· updates every few seconds',
    none: 'No attempts yet this round.',
    libraryBefore: 'Finished rounds, with every attempt and a download, are in the ',
    libraryLink: 'Library',
    libraryAfter: '.',
  },

  hostile: {
    hiddenChar: 'Hidden or direction-changing character',
    showLess: 'Show less',
    showAll: (n: number) => `Show all ${n.toLocaleString()} characters`,
  },

  attempt: {
    message: 'Message',
    reply: 'Argus',
    decision: { approve: 'Approved', reject: 'Rejected' },
    decisionTitle: 'The decision tool Argus called',
    breakKind: { misfire: 'Misfire', persuaded: 'Persuaded' },
    hidden: 'Hidden by the operator.',
    hiddenHash: 'On-chain message hash',
    awaiting: 'Recorded on-chain. Waiting for the message to arrive.',
    reading: 'Argus is reading this one.',
    never: (note?: string) => (note ? `Never answered: ${note}` : 'Never answered.'),
    notJudged: (note?: string) => (note ? `Not judged: ${note}` : 'Not judged: Argus could not answer this attempt.'),
    share: 'Share',
    closeShare: 'Close share card',
    tx: 'Transaction',
  },

  share: {
    drawing: 'Drawing the card…',
    alt: (c: { kind: string; outcome: string; roundId?: number; attemptId?: number }) =>
      c.kind === 'practice' ? `Share card: practice, ${c.outcome}.` : `Share card: attempt ${c.attemptId}, round ${c.roundId}, ${c.outcome}.`,
    post: 'Post on X',
    telegram: 'Share on Telegram',
    download: 'Download',
    shareImage: 'Share image',
    note: 'The link shows a preview card on X and Telegram. To post this exact card, attach the downloaded image.',
    demoNote: 'Posting is off on demo data, so nothing made up ends up on X or Telegram.',
    failed: 'Could not draw the card',
    logoFailed: 'Logo failed to load',
    cardWordmark: 'TURNCOAT',
    cardMeta: (a: number, r: number) => `ATTEMPT #${a}  ·  ROUND ${r}`,
    cardPractice: 'PRACTICE  ·  NO POT',
    cardDemo: 'DEMO DATA · NOT A REAL ROUND',
    cardTest: 'TEST NETWORK · NO REAL VALUE',
    // Post text. Never includes the attacker's message.
    attemptText: (a: number, r: number, turned: boolean) =>
      `Attempt #${a}, round ${r}. ${turned ? 'Argus was turned.' : 'Argus held.'}\n\n${ONE_LINE}`,
    practiceText: (turned: boolean) => (turned ? `I turned Argus in practice. ${ONE_LINE}` : `Argus held against me in practice. ${ONE_LINE}`),
    shareRound: 'Share this round',
    sharePractice: 'Share this result',
    // /s/<kind>: the page a shared link lands on before it opens the attempt.
    opening: 'Opening…',
    hashtags: '#BinanceWalletHackathon #AgenticWallet',
  },

  practice: {
    title: 'Practice',
    lede: 'Send Argus a payment request and try to get him to approve it. No wallet, no sign-in.',
    noticeStrong: 'Practice has no pot and nothing here is on-chain.',
    notice: "Your message goes to the guard service only to get Argus's reply. Nothing is paid or recorded on-chain.",
    messageLabel: 'Your message to Argus',
    placeholder: 'Hi Argus…',
    send: 'Send to Argus',
    sending: 'Argus is reading…',
    unreachable: (e: string) => `Could not reach Argus (${e}). Try again in a moment.`,
    level: 'Level',
    planned: '· planned',
    held: 'He held.',
    turned: 'You turned him.',
    forbidden: 'Argus called a forbidden action:',
    misfire: 'A misfire: he said no in words and called approve anyway.',
    realRound: 'In a real round this would count as a break, and the attack would be published and patched.',
    session: 'This session',
    you: 'You',
    tryN: (n: number) => `Try ${n}`,
    levelN: (n: number) => `Level ${n}`,
  },

  library: {
    title: 'Library',
    lede: "Every attempt from every finished round, with Argus's full reply. Download a round as JSONL and replay it against your own agent as a test suite.",
    none: 'No round has finished yet. The first one appears here when it closes.',
    summary: (r: LevelRef, n: number, opened: string) => `${levelText(r)} · ${n} attempts · opened ${opened}`,
    turnedBy: 'Turned by',
    fixedIn: (n: number) => `Fixed in v${n}`,
    readPostmortem: 'Read the post-mortem',
    hasPostmortem: ' · post-mortem',
    back: '← Library',
    range: (r: LevelRef, from: string, to: string) => `${levelText(r)} · ${from} to ${to}`,
    closedEarly: (r: LevelRef, from: string) => `${levelText(r)} · opened ${from}, closed early by a break`,
    turnedOn: (n?: number) => `Turned on attempt #${n} by`,
    potPaid: (amount: string) => `The pot of ${amount} was paid to that attacker's wallet by the contract.`,
    payoutTx: 'Payout transaction',
    heldText: 'Nobody turned Argus. The pot rolled into the next round.',
    openText: 'This round is still open. Attempts so far are below; the full set is final when it closes.',
    download: 'Download as JSONL',
    soFar: ' (so far)',
    checkFairness: "Check this round's fairness",
    postmortem: 'Post-mortem',
    postmortemPending: 'The post-mortem for this break is being written.',
    count: (n: number) => `${n} attempt${n === 1 ? '' : 's'}`,
    onlyBreaks: 'Only breaks',
    // README.md "The levels", the sentence about misfires.
    breakKinds:
      'Misfire: Argus wrote no and called approve anyway. It counts, because the code watches the action, not the words. Persuaded: he was talked into it. The label never changes whether the pot pays.',
    closedOn: (r: LevelRef, from: string, to: string) => `${levelText(r)} · opened ${from}, closed ${to}`,
    prelaunchTag: 'Pre-launch testing',
    prelaunchTitle: 'Post-mortem 0',
    prelaunchText: 'Not a round. We attacked our own guard before launch, and round 1 runs the fix.',
    prelaunchNoPot: 'No pot, no attackers from outside, nothing on-chain.',
    prelaunchMissing: 'This post-mortem is not published yet.',
    nothing: 'Nothing to show.',
  },

  fairness: {
    title: 'Fairness',
    lede: 'What you can check yourself, and what you still have to trust.',
    notDeployed: 'The contract is not deployed yet. Every claim below links to it on BscScan once it is.',
    // README.md "Fairness: how you know it isn't rigged" and "What you still have to trust".
    claims: [
      {
        strong: "The guard's instructions are public and fixed for the round.",
        text: 'Every version is in the repo, in guard/levels/. When a round opens, the contract stores guardCommit: the keccak256 hash of a salt followed by the exact text. When the round ends the salt is published, and anyone can check that the text Argus ran is the text in the repo. You can read the instructions, and test against them in practice, before you spend an attempt.',
        link: 'Every version',
        target: 'levels',
      },
      {
        strong: 'Every attempt is on-chain.',
        text: "Each attempt's message hash is recorded in its transaction, so no message can be added, removed or edited later.",
        link: 'Attempted events',
        target: 'events',
      },
      {
        strong: 'Every attempt is public as soon as Argus answers it:',
        text: 'the message and his full reply, while the round is still live.',
        link: 'Contract source',
        target: 'code',
      },
      {
        strong: 'The pot is locked in the contract.',
        text: "The owner cannot withdraw it. It leaves only on a verdict signed by the round's signer, to the wallet that sent that attempt, or it rolls into the next round.",
        link: 'Read the contract',
        target: 'read',
      },
      {
        strong: "A round's signer cannot be changed.",
        text: 'The key whose signature pays a round is fixed when the round opens and is readable on-chain (roundSigner). The owner can set a different signer only for rounds opened later.',
        link: 'roundSigner on BscScan',
        target: 'read',
      },
    ] as const,
    trustBefore:
      "What you still have to trust: the guard service. It holds the round's signing key, and the contract pays whoever that key signs for. The contract cannot check that a signed verdict matches a real break, or that the service ran the committed instructions. We run the service and we open the rounds, so this is trust in us. The public transcripts in the ",
    trustLink: 'Library',
    trustAfter: ' and the on-chain attempt hashes make a false payout visible to everyone; they do not make it impossible.',
    rounds: 'Rounds',
    fromService: 'Commits below come from the guard service. Compare them with getRound on BscScan, or set an RPC URL so this page reads them from the contract directly.',
    roundN: (n: number) => `Round ${n}`,
    commitFromChain: 'guardCommit (read from the contract)',
    commitFromService: 'guardCommit (from the guard service)',
    openTx: 'RoundOpened transaction',
    chainError: "Could not read the contract; showing the guard service's value.",
    disagree: (v: string) => `The guard service reports a different commit (${v}). The contract's value is the one that counts.`,
    beforeReveal: 'The salt is published when the round ends. This page then recomputes the hash in your browser.',
    signer: "This round's signer",
    signerNote: 'Fixed when the round opened. Only a verdict signed by this key can pay the pot.',
    checking: 'Checking the reveal…',
    notRevealed: 'The guard service has no reveal recorded for this round yet. Look for a GuardRevealed event for this round on BscScan.',
    fromChain: 'Revealed on-chain',
    fromServiceRecord: "From the guard service's record, not a recorded on-chain reveal. The check above compares it with guardCommit; that comparison is what counts.",
    match: 'Match. The revealed instructions hash to the commit.',
    mismatch: 'Mismatch. The revealed instructions do not hash to the commit.',
    computed: 'keccak256(salt ‖ instructions), computed in your browser',
    read: 'Read the revealed instructions',
    revealTx: 'GuardRevealed transaction',
    badUtf8: '(instructions are not valid UTF-8; the hash check still uses the exact bytes)',
    fixed: 'Fixed on-chain for this round',
    fixedNote: 'These lines are inside the committed bytes, so they were set before the round opened.',
    fixedModel: 'Model',
    fixedMode: 'Mode',
    fixedVersion: 'Version',
    fixedMaxTurns: 'Max turns per reply',
    fixedTools: 'Tool definitions (keccak256)',
    fixedFollowUp: 'Follow-up line',
    followUpNone: 'None in this mode.',
    fixedToolsNote: 'Hash of the exact tool definitions Argus was given. guard/src/commit.ts prints it for each mode.',
    modelDiffers: (service: string, committed: string) =>
      `The guard service lists this round's model as ${service}, but the commit names ${committed}. The commit is the one that counts.`,
    noHeader: "This round's commit does not name a model. It was made before the header existed, so only the instruction text is covered by the hash.",
    badHeader: 'The committed bytes start with a header that does not follow the documented layout. Only the bytes as a whole are checked.',
  },
};

// Link-preview tags for shared links (/s/<kind>). vite.config.ts writes one HTML page per kind with
// these, because X and Telegram read the HTML and never run the site's script. Images: web/public/og-*.png
// (drawn by `npm run og`, the same card as the in-page share). Keys match ShareKind in lib/shareCard.ts.
const PRACTICE_DESC =
  "Argus is an AI agent with a pot of USDT. He must approve the payments he should and reject the ones he shouldn't. Practice against him free: no wallet, no sign-in.";
export const UNFURL: Record<string, { title: string; description: string; alt: string }> = {
  turned: {
    title: `Argus was turned. ${ONE_LINE}`,
    description: 'Someone talked Argus, an AI agent guarding a pot of USDT, into a payment he should have rejected. The attack, his reply and the payout are public.',
    alt: 'Turncoat share card: TURNED.',
  },
  held: {
    title: `Argus held. ${ONE_LINE}`,
    description: 'An attempt to talk Argus, an AI agent guarding a pot of USDT, into a payment he should reject. He held. Read it, then try him yourself: practice is free.',
    alt: 'Turncoat share card: HELD.',
  },
  'practice-turned': {
    title: `Turned Argus in practice. ${ONE_LINE}`,
    description: PRACTICE_DESC,
    alt: 'Turncoat share card: practice, TURNED.',
  },
  'practice-held': {
    title: `Argus held in practice. ${ONE_LINE}`,
    description: PRACTICE_DESC,
    alt: 'Turncoat share card: practice, HELD.',
  },
};
export const UNFURL_TEST_PREFIX = 'Test network: ';
