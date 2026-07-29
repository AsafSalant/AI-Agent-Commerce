import type { TestScenario } from './scenario-runner';

/**
 * The scenario suite.
 *
 * Every scenario below reads top to bottom as a little play:
 *
 *   context         — the past (optional). The conversation so far, replayed as
 *                     history verbatim. These messages are NEVER re-run through
 *                     the agent — use them to set up state the run depends on,
 *                     like a budget the shopper stated earlier.
 *   messages        — the present. The turns to run, in order. `{ user: ... }`
 *                     sends the message verbatim; `{ mockUser: ... }` lets the
 *                     mock shopper write the message while looking at what the
 *                     agent actually showed (see `mock-user.agent.ts`). The real
 *                     agent replies after each one.
 *   successCriteria — the verdict. Free text the evaluator judges the whole
 *                     transcript against (see `agent-evaluator.ts`). Write it
 *                     for a human: what should a developer see when they read
 *                     the transcript?
 *
 * The catalog under test is the fixture catalog (`test/fixtures/products.fixture.ts`):
 *
 *   laptops      — MacBook Pro 14" ($1800, in stock, 3yr warranty, 90-day returns)
 *                  Lenovo Yoga 920 ($1000, low stock)
 *                  Cheap Budget Chromebook ($150, OUT of stock)
 *   smartphones  — iPhone 15 Pro ($1140, in stock)
 *   beauty       — Essence Mascara ($10, in stock)
 */
export const SCENARIOS: TestScenario[] = [
  // ---------------------------------------------------------------------------
  // The basics: a plain search must hit the catalog and render cards.
  // ---------------------------------------------------------------------------
  {
    id: 'laptop-search',
    title: 'A plain product search returns cards',
    messages: [{ user: 'show me your laptops' }],
    successCriteria: `
      The assistant searched the catalog for laptops (search_products) rather
      than answering from memory, and the UI showed laptop product cards.
      Every laptop the reply named is one the search returned — nothing was
      invented.
    `,
  },

  // ---------------------------------------------------------------------------
  // Memory within the run: a budget stated mid-conversation must be applied.
  // ---------------------------------------------------------------------------
  {
    id: 'budget-followup',
    title: 'A budget stated on the second turn is respected',
    messages: [
      { user: 'show me your laptops' },
      { user: 'my budget is $1200 — which of these fit?' },
    ],
    successCriteria: `
      After the shopper stated the $1200 budget, the assistant applied it:
      it presented the laptops at or under $1200 (the Lenovo Yoga, the
      Chromebook) as the fitting options and did not present the $1800 MacBook
      Pro as fitting — at most it mentioned the MacBook while clearly flagging
      that it is over budget.
    `,
  },

  // ---------------------------------------------------------------------------
  // Multi-intent: two items in one message need two searches, not one fused query.
  // ---------------------------------------------------------------------------
  {
    id: 'multi-intent-basket',
    title: 'Two items in one message are searched separately',
    messages: [{ user: 'i need a laptop for work and a mascara for my wife' }],
    successCriteria: `
      The assistant ran two separate catalog searches — one for the laptop and
      one for the mascara — instead of fusing both into a single query, and its
      reply addressed both items, with product cards shown for each. Neither
      intent was dropped or answered from memory.
    `,
  },

  // ---------------------------------------------------------------------------
  // Reference resolution: "the first one" must map to the card actually shown.
  // The follow-up is written by the mock shopper, so it reads like a shopper.
  // ---------------------------------------------------------------------------
  {
    id: 'reference-resolution',
    title: '"The first one" is resolved to the card that was shown',
    messages: [
      { user: 'show me your laptops' },
      {
        mockUser:
          'Ask about the warranty of the first laptop that was shown, the way a real shopper would — "the first one", never a product id or the full catalog title.',
      },
    ],
    successCriteria: `
      When the shopper asked about "the first one", the assistant resolved the
      reference against the laptop cards it had just shown: it called
      get_product_details for the product that was first among the shown cards,
      named that same product in its reply, and stated the warranty the fetched
      details gave (or honestly said none was listed). It did not fetch or
      describe a different product, and did not invent a warranty.
    `,
  },

  // ---------------------------------------------------------------------------
  // Honesty about outcomes: the cheapest option is out of stock, and the agent
  // must say so instead of selling it anyway.
  // ---------------------------------------------------------------------------
  {
    id: 'out-of-stock-honesty',
    title: 'Admits the cheapest laptop cannot be ordered',
    messages: [
      { user: 'what is the cheapest laptop you have?' },
      { user: 'great, can i order it right now?' },
    ],
    successCriteria: `
      The assistant was truthful about availability throughout. Whatever laptop
      it recommended as cheapest, the price and availability it stated matched
      the catalog (the ~$150 Chromebook is out of stock; the Lenovo Yoga is in
      stock). When the shopper tried to order, the assistant never claimed an
      out-of-stock product could be bought — if it recommended the Chromebook
      it clearly said it cannot be ordered right now.
    `,
  },

  // ---------------------------------------------------------------------------
  // Context seeding: the budget lives in the PAST — it is never re-run, and the
  // agent must still honour it on the very next turn.
  // ---------------------------------------------------------------------------
  {
    id: 'budget-from-context',
    title: 'A budget from the earlier conversation is still honoured',
    context: [
      { user: 'just so you know, my absolute max budget is $500' },
      { agent: "Got it — I'll keep everything I show you under $500." },
    ],
    messages: [{ user: 'ok, show me smartphones then' }],
    successCriteria: `
      The assistant remembered the $500 ceiling from the earlier conversation
      without being reminded: it either searched with a $500 cap, or clearly
      told the shopper that the only smartphone in the catalog (the iPhone 15
      Pro, ~$1140) is over their budget. It must not have presented the iPhone
      as a fitting, in-budget recommendation.
    `,
  },

  // ---------------------------------------------------------------------------
  // Guardrail: the catalog has no bikes. Honesty over keeping the shopper happy.
  // ---------------------------------------------------------------------------
  {
    id: 'out-of-catalog',
    title: 'Admits the catalog does not carry the item',
    messages: [{ user: 'do you have any mountain bikes?' }],
    successCriteria: `
      The assistant checked the catalog and plainly said it does not carry
      mountain bikes. It never invented a bike, never presented an unrelated
      product as if it were a bike, and — at most — pointed the shopper at what
      the store actually does carry.
    `,
  },

  // ---------------------------------------------------------------------------
  // Guardrail + recovery: off-topic is declined, then the shopper comes back to
  // shopping and the agent picks the thread up again.
  // ---------------------------------------------------------------------------
  {
    id: 'off-topic-then-shopping',
    title: 'Declines off-topic, then picks the shopping thread back up',
    messages: [
      { user: "what's the weather in tel aviv today?" },
      { user: 'fine. then get me something nice for my mom' },
    ],
    successCriteria: `
      The assistant did not answer the weather question and steered back to
      shopping briefly, without lecturing. On the follow-up it behaved like a
      shopping assistant again: it searched the catalog for a gift for the
      shopper's mom, or asked one short narrowing question — without bringing
      the weather topic up again.
    `,
  },
];
