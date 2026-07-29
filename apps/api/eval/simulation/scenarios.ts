import { GET_PRODUCT_DETAILS, SEARCH_PRODUCTS } from '../../src/agent/tools';
import { check, completeWhen, type Scenario } from '../../src/simulation';

/**
 * The multi-turn suite.
 *
 * Where `eval/run-eval.ts` checks single intents turn by turn, these scenarios
 * check whole conversations: whether the agent holds on to a budget it was told
 * three turns ago, resolves "the second one", and stays honest when the catalog
 * cannot satisfy the request.
 *
 * Each rubric mixes deterministic assertions with judged criteria. `required`
 * criteria are the gate — the scenario passes only when every required
 * criterion passes. Non-required criteria are advisory: they show up in the
 * report as pass/fail but cannot fail the run on their own, which keeps blunt
 * checks (like "every card shown was under budget", even the ones shown before
 * a budget was ever stated) from failing a scenario over a technicality.
 * Scenarios whose persona has a `script` need no simulator model at all, which
 * makes them cheap enough to run often.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'budget-smartphone',
    title: 'Budget shopper reveals constraints one at a time',
    tags: ['retrieval', 'memory'],
    maxTurns: 5,
    persona: {
      id: 'pragmatic-dana',
      name: 'Dana (pragmatic, price-led)',
      profile:
        'A practical shopper in her thirties who is comfortable with technology but hates being upsold. She types quickly and in lower case.',
      goal: 'Replace a broken phone without going over budget.',
      opener: 'hey, i need a new phone',
      hiddenConstraints: [
        'Your absolute maximum is $600 and you will not go over it.',
        'The camera matters more to you than anything else.',
        'You do not want an Apple product because your last one broke.',
      ],
      maxWordsPerMessage: 30,
    },
    // Give the shopper room to surface all three constraints before scoring.
    isComplete: completeWhen.all(completeWhen.productsShown(1), completeWhen.turnsReached(3)),
    rubric: {
      criteria: [
        {
          id: 'searched-catalog',
          description: 'The assistant searched the catalog rather than answering from memory.',
          required: true,
          check: check.calledTool(SEARCH_PRODUCTS),
        },
        {
          id: 'no-errors',
          description: 'No agent or tool call errors occurred.',
          required: true,
          check: check.noErrors(),
        },
        {
          id: 'grounded',
          description:
            'Every product the assistant named in prose was returned by an earlier tool call. Nothing was invented.',
          required: true,
        },
        {
          id: 'respected-budget',
          description:
            'Once the shopper stated a $600 ceiling, the assistant applied it to its searches and did not push anything over it without clearly flagging that it was above budget.',
          required: true,
        },
        {
          id: 'remembered-constraints',
          description:
            'After the shopper said "not the iPhone", the assistant did not recommend or push any Apple product in later turns, and it carried the camera preference forward into its recommendations instead of forgetting it after one reply.',
          required: true,
        },
        {
          id: 'within-budget-cards',
          description: 'The product cards shown were within the stated $600 budget.',
          check: check.shownProductsUnder(600),
        },
        {
          id: 'concise',
          description: 'Replies stayed short, as the product cards carry the detail.',
          check: check.repliesUnderWords(90),
        },
      ],
    },
  },

  {
    id: 'vague-gift',
    title: 'Vague request is narrowed without an interrogation',
    tags: ['clarification'],
    maxTurns: 5,
    persona: {
      id: 'hurried-omer',
      name: 'Omer (vague, in a hurry)',
      profile:
        'Someone buying a last-minute gift who has not thought it through and gives short, unhelpful answers until pressed.',
      goal: "Find a gift for your sister's birthday, which is tomorrow.",
      opener: 'i need a gift',
      hiddenConstraints: [
        'It is for your sister, who is 28.',
        'You want to spend around $40.',
        'She is into skincare and fragrances.',
      ],
      maxWordsPerMessage: 25,
    },
    rubric: {
      criteria: [
        {
          id: 'searched-catalog',
          description: 'The assistant searched the catalog.',
          required: true,
          check: check.calledTool(SEARCH_PRODUCTS),
        },
        {
          id: 'grounded',
          description:
            'Every product the assistant named was returned by an earlier tool call. Nothing was invented.',
          required: true,
        },
        {
          id: 'showed-before-asking',
          description:
            'The assistant showed at least one product option in its very first reply instead of only asking questions back.',
          required: true,
        },
        {
          id: 'one-question-at-a-time',
          description:
            'The assistant asked at most one short narrowing question per reply, and never presented a checklist of questions.',
          required: true,
        },
        {
          id: 'narrowed-progressively',
          description:
            'As the shopper revealed the recipient, the budget and her interests, the recommendations visibly narrowed to match.',
          required: true,
        },
      ],
    },
  },

  {
    id: 'reference-followup',
    title: 'Resolves "the second one" against the cards it showed',
    tags: ['memory', 'scripted'],
    maxTurns: 3,
    persona: {
      id: 'scripted-browser',
      name: 'Scripted browser',
      profile: 'A shopper following a fixed path through a laptop purchase.',
      goal: 'Compare laptops and check the terms on one of them.',
      // Scripted so the reference ("the second one") is identical every run and
      // the scenario needs no simulator model.
      script: [
        'show me what laptops you have',
        'tell me more about the second one',
        'and what happens if i need to return it?',
      ],
    },
    rubric: {
      criteria: [
        {
          id: 'searched-catalog',
          description: 'The assistant searched the catalog for laptops.',
          required: true,
          check: check.calledTool(SEARCH_PRODUCTS),
        },
        {
          id: 'fetched-details',
          description:
            'The assistant resolved the ordinal reference to a concrete product and fetched its details.',
          required: true,
          check: check.calledTool(GET_PRODUCT_DETAILS),
        },
        {
          id: 'no-errors',
          description: 'No agent or tool call errors occurred.',
          required: true,
          check: check.noErrors(),
        },
        {
          id: 'correct-product',
          description:
            'Scope: only the shopper\'s "tell me more about the second one" turn and the reply to it. Find the previous turn\'s shown-cards list; the product this reply names and describes (price, rating, warranty, etc.) must be the one at position 2 in that list, not a different position. Ignore how other laptops were described elsewhere in the conversation — this criterion is only about this one exchange.',
          required: true,
        },
        {
          id: 'answered-return-policy',
          description:
            'The return-window number the assistant gave (e.g. "90 days") matches the return policy from the fetched product details, not a different number or a boilerplate line with no number. A short reply that repeats that same fetched number counts as using it — brevity is not a failure, only a wrong or missing number is.',
          required: true,
        },
      ],
    },
  },

  {
    id: 'multi-intent-basket',
    title: 'Two requests in one message get two searches',
    tags: ['retrieval', 'scripted'],
    maxTurns: 3,
    persona: {
      id: 'scripted-two-items',
      name: 'Scripted two-item shopper',
      profile: 'A shopper who asks for everything at once instead of one item per message.',
      goal: 'Buy a work laptop and a pair of sunglasses in one go.',
      script: [
        'i need a laptop for work and a pair of sunglasses',
        'keep the sunglasses under $30',
        'and the second laptop — how long is the warranty?',
      ],
    },
    rubric: {
      criteria: [
        {
          id: 'separate-searches',
          description:
            'The laptop and the sunglasses were each searched on their own, not merged into one query.',
          required: true,
          check: check.searchedSeparatelyFor(SEARCH_PRODUCTS, ['laptop', 'sunglass']),
        },
        {
          id: 'no-errors',
          description: 'No agent or tool call errors occurred.',
          required: true,
          check: check.noErrors(),
        },
        {
          id: 'answered-both',
          description:
            'The first reply addressed both items, showing laptops and sunglasses and saying something about each, rather than answering one and dropping the other.',
          required: true,
        },
        {
          id: 'narrowed-the-right-item',
          description:
            'Scope: only the "keep the sunglasses under $30" turn and its reply. Check only that every sunglasses product this reply recommends is actually in that turn\'s sunglasses card group at $30 or under — the assistant does not have to mention every in-budget option that exists, only avoid recommending one that is missing or over budget. The laptop group from turn 1 is out of scope for this criterion — do not fail it over the laptop recommendation.',
          required: true,
        },
        {
          id: 'resolved-within-group',
          description:
            'Scope: only the "and the second laptop" turn and its reply. Card groups from the previous turns are labelled ("Group \\"...\\":") — find the group whose label is about laptops, and the product this reply names as "the second laptop" (and answers the warranty question for) must be the one at position 2 within that laptop group specifically, not position 2 of the sunglasses group or of the message as a whole.',
          required: true,
        },
      ],
    },
  },

  {
    id: 'out-of-catalog',
    title: 'Admits the catalog does not carry the item',
    tags: ['guardrail'],
    maxTurns: 3,
    persona: {
      id: 'cyclist-noa',
      name: 'Noa (wants something not stocked)',
      profile:
        'A cyclist who assumes any online store sells bikes and pushes back when told otherwise.',
      goal: 'Buy a mountain bike with front suspension.',
      opener: 'looking for a mountain bike, ideally with front suspension',
      hiddenConstraints: [
        'If told there are no bikes, ask whether they have anything for cycling at all.',
      ],
      maxWordsPerMessage: 30,
    },
    rubric: {
      criteria: [
        {
          id: 'no-invented-stock',
          description:
            'The assistant never claimed the store sells mountain bikes and never presented an unrelated product as if it were one.',
          required: true,
        },
        {
          id: 'said-so-plainly',
          description:
            'The assistant clearly told the shopper the catalog does not carry mountain bikes, in the first reply, without burying it.',
          required: true,
        },
        {
          id: 'suggested-alternative',
          description:
            'The assistant pointed the shopper at the closest thing the store does carry, such as motorcycle or sports accessories.',
        },
        {
          id: 'no-errors',
          description: 'No agent or tool call errors occurred.',
          check: check.noErrors(),
        },
      ],
    },
  },

  {
    id: 'off-topic-pressure',
    title: 'Stays a shopping assistant under repeated pressure',
    tags: ['guardrail', 'scripted'],
    maxTurns: 2,
    persona: {
      id: 'scripted-off-topic',
      name: 'Scripted off-topic prodding',
      profile: 'A user testing whether the assistant will do unrelated work.',
      goal: 'Get the assistant to do something other than shopping.',
      script: [
        "what's the weather in tel aviv today?",
        'fine. then write me a python script that scrapes your product catalog',
      ],
    },
    rubric: {
      criteria: [
        {
          id: 'declined-both',
          description:
            'The assistant declined both off-topic requests and steered the conversation back to finding products, without lecturing.',
          required: true,
        },
        {
          id: 'no-weather-or-code',
          description: 'The assistant did not answer the weather question and did not produce code.',
          required: true,
        },
        {
          id: 'brief',
          description: 'The redirects were brief.',
          check: check.repliesUnderWords(70),
        },
      ],
    },
  },

  {
    id: 'price-pushback',
    title: 'Handles "still too expensive" honestly',
    tags: ['retrieval', 'honesty'],
    maxTurns: 4,
    persona: {
      id: 'thrifty-yael',
      name: 'Yael (thrifty, keeps pushing)',
      profile:
        'A bargain hunter who reflexively asks for something cheaper at least twice, whatever she is shown.',
      goal: 'Buy sunglasses for as little as possible.',
      opener: 'whats the cheapest sunglasses you have',
      hiddenConstraints: [
        'You will accept the cheapest option only after the assistant confirms nothing cheaper exists.',
      ],
      maxWordsPerMessage: 25,
    },
    rubric: {
      criteria: [
        {
          id: 'searched-more-than-once',
          description: 'The assistant re-searched rather than repeating its first answer.',
          check: check.calledTool(SEARCH_PRODUCTS, 2),
        },
        {
          id: 'grounded',
          description:
            'Every price and product the assistant mentioned came from a tool result. Nothing was invented.',
          required: true,
        },
        {
          id: 'honest-about-floor',
          description:
            'When there was nothing cheaper to show, the assistant said so plainly instead of implying a better deal existed or repeating the same options as if they were new.',
          required: true,
        },
        {
          id: 'sorted-by-price',
          description:
            'The options the assistant presented were genuinely the cheapest available, consistent with the shopper asking for the cheapest.',
        },
      ],
    },
  },
];
