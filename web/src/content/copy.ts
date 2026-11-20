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
    demoLabel: 'Demo data',
    demoBanner: 'Not a real round. Every name, number and result on this site is made up.',
    homeLabel: 'Turncoat home',
    nav: { live: 'Live', practice: 'Practice', library: 'Library', fairness: 'Fairness' },
    contractLink: 'Contract on BscScan',
    contractMissing: 'Contract address: added at deployment.',
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
    argus: 'Argus is an AI agent with a pot of USDT and one rule: never give it away.',
    practiceCta: 'Practice against Argus',
    practiceNote: 'Free. No wallet, no sign-in.',
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
      { to: '/fairness', label: 'Fairness', text: "Argus's instructions are committed on-chain before each round. Check the hash yourself after it ends." },
    ],
    logoAlt: 'Turncoat: a half-closed eye with a keyhole for a pupil',
  },

  claim: {
    heading: 'Claim an Agent ID to play for the pot',
    step1Strong: 'Claim your Agent ID in your Agentic Wallet.',
    step1: "One per person, and it can't be transferred.",
    step1Link: 'How to claim',
    step2Strong: 'Install the Turncoat skill in your agent.',
    step2Link: 'Get the skill',
    step2Missing: 'Not published yet. The link appears here when it is.',
    step3Strong: 'Tell your agent:',
    say: 'attack Argus',
    step3: 'It asks for your message, shows you the transaction and waits for you to confirm. One free attempt a day; you pay network gas only.',
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
    awaiting: 'Recorded on-chain. Waiting for the message to arrive.',
    reading: 'Argus is reading this one.',
    never: (note?: string) => (note ? `Never answered: ${note}` : 'Never answered.'),
    share: 'Share',
    closeShare: 'Close share card',
    tx: 'Transaction',
  },

  share: {
    drawing: 'Drawing the card…',
    alt: (a: number, r: number, o: string) => `Share card: attempt ${a}, round ${r}, ${o}.`,
    post: 'Post on X',
    download: 'Download',
    shareImage: 'Share image',
    note: 'X opens with the post filled in. To include the card, attach the downloaded image.',
    demoNote: 'Posting is off on demo data, so nothing made up ends up on X.',
    failed: 'Could not draw the card',
    logoFailed: 'Logo failed to load',
    cardWordmark: 'TURNCOAT',
    cardMeta: (a: number, r: number) => `ATTEMPT #${a}  ·  ROUND ${r}`,
    cardDemo: 'DEMO DATA · NOT A REAL ROUND',
    // The X post. Never includes the attacker's message.
    post_text: (a: number, r: number, turned: boolean, link: string) =>
      `Attempt #${a}, round ${r}. ${turned ? 'Argus was turned.' : 'Argus held.'}\n\n${ONE_LINE}\n\n${link}\n\n#BinanceWalletHackathon #AgenticWallet`,
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
    heldText: 'Nobody turned Argus. The pot rolled into the reserve for later rounds.',
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
    lede: "How you can check a round wasn't rigged, without trusting us.",
    notDeployed: 'The contract is not deployed yet. Every claim below links to it on BscScan once it is.',
    claims: [
      {
        strong: "Argus's instructions are committed before the round.",
        text: 'When a round opens, the contract stores guardCommit, the keccak256 hash of a secret salt followed by the instructions. It cannot change after that.',
        link: 'Contract source',
        target: 'code',
      },
      {
        strong: 'They are revealed when the round ends.',
        text: 'The contract only accepts revealed text that matches the commit, and publishes it in a GuardRevealed event. Below, your browser recomputes the hash too.',
        link: 'Contract events',
        target: 'events',
      },
      {
        strong: 'Every attempt is on-chain.',
        text: "Each attempt's message hash is stored in its transaction, so no message can be added, removed or edited later.",
        link: 'Attempted events',
        target: 'events',
      },
      {
        strong: 'The pot is locked in the contract.',
        text: 'The owner cannot withdraw it. It leaves only to an attacker with a valid break, or rolls into the reserve.',
        link: 'Read the contract',
        target: 'read',
      },
    ] as const,
    trustBefore: 'What you still have to trust: that the guard service ran the committed instructions honestly during the round. The published transcripts in the ',
    trustLink: 'Library',
    trustAfter: ' make cheating visible afterwards; they do not make it impossible.',
    rounds: 'Rounds',
    fromService: 'Commits below come from the guard service. Compare them with getRound on BscScan, or set an RPC URL so this page reads them from the contract directly.',
    roundN: (n: number) => `Round ${n}`,
    commitFromChain: 'guardCommit (read from the contract)',
    commitFromService: 'guardCommit (from the guard service)',
    openTx: 'RoundOpened transaction',
    chainError: "Could not read the contract; showing the guard service's value.",
    disagree: (v: string) => `The guard service reports a different commit (${v}). The contract's value is the one that counts.`,
    sealed: 'Instructions stay sealed until the round ends.',
    checking: 'Checking the reveal…',
    notRevealed: 'The instructions for this round have not been revealed yet.',
    match: 'Match. The revealed instructions hash to the commit.',
    mismatch: 'Mismatch. The revealed instructions do not hash to the commit.',
    computed: 'keccak256(salt ‖ instructions), computed in your browser',
    read: 'Read the revealed instructions',
    revealTx: 'GuardRevealed transaction',
    badUtf8: '(instructions are not valid UTF-8; the hash check still uses the exact bytes)',
  },
};
