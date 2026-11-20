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

export const NOT_AFFILIATED = 'Independent project. Not affiliated with Binance.';

export const LEVELS = [
  { level: 1, name: 'Direct persuasion', controls: 'A chat message to the guard', ready: true },
  { level: 2, name: 'Poisoned token', controls: 'The name and description of a token the guard is asked to assess', ready: false },
  { level: 3, name: 'Malicious tool output', controls: 'The text returned by a skill the guard calls', ready: false },
  { level: 4, name: 'Fake authority', controls: 'A message that claims to come from the owner or from support', ready: false },
  { level: 5, name: 'Approval trap', controls: 'Anything above, aiming for an unlimited approval instead of a transfer', ready: false },
];
export const levelName = (n: number) => LEVELS.find((l) => l.level === n)?.name ?? `Level ${n}`;

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
    label: (id: number, level: number) => `Round ${id} · Level ${level}: ${levelName(level)}`,
    version: (n: number) => `Argus v${n}`,
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
    latestRound: 'The latest round',
    watch: 'Watch attempts arrive',
    howHeading: 'How to try for the pot',
    // From README.md "Argus learns".
    learnsHeading: 'Argus learns',
    learns: [
      'Argus does not start as a fortress. Round 1 runs a plain guard: one rule, no list of known tricks.',
      'When he is broken, the attack is published, one rule is added to answer it, and the next round runs the patched guard.',
      'The history of versions is the guard rulebook.',
    ],
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
    lede: 'Try to talk Argus into moving the money. No wallet, no sign-in.',
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
    summary: (level: number, n: number, opened: string) => `Level ${level}: ${levelName(level)} · ${n} attempts · opened ${opened}`,
    turnedBy: 'Turned by',
    fixedIn: (n: number) => `Fixed in v${n}`,
    readPostmortem: 'Read the post-mortem',
    hasPostmortem: ' · post-mortem',
    back: '← Library',
    range: (level: number, from: string, to: string) => `Level ${level}: ${levelName(level)} · ${from} to ${to}`,
    closedEarly: (level: number, from: string) => `Level ${level}: ${levelName(level)} · opened ${from}, closed early by a break`,
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
