import {
  advisory,
  avoidsHedgingFiller,
  coversCategories,
  everyProductInCategories,
  everyProductRatedAtLeast,
  everyProductUnder,
  includesProductTitled,
  mentionsAnyOf,
  namedProductsWereRetrieved,
  pricesAreGrounded,
  productsSortedByPriceAscending,
  replyIsConcise,
  searchedSeparatelyFor,
  showsCardGroups,
  showsNoProducts,
  showsProducts,
  usedTool,
  type Check,
} from './checks';

export interface EvalTurn {
  prompt: string;
  checks: Check[];
}

export interface EvalScenario {
  id: string;
  intent: string;
  turns: EvalTurn[];
}

/**
 * Behavioural expectations for the copilot, expressed as intents a shopper
 * would actually type. Each check asserts something observable in the turn:
 * which tools ran, which products came back, and whether the spoken answer
 * stayed grounded in them.
 */
export const SCENARIOS: EvalScenario[] = [
  {
    id: 'budget-laptop',
    intent: 'Budget constraint is translated into a price filter',
    turns: [
      {
        prompt: 'I need a laptop for work under $1500',
        checks: [
          usedTool('search_products'),
          showsProducts(1),
          everyProductUnder(1500),
          pricesAreGrounded([1500]),
          replyIsConcise(),
        ],
      },
    ],
  },
  {
    id: 'category-browse',
    intent: 'Category browsing without keywords',
    turns: [
      {
        prompt: 'What kind of furniture do you sell?',
        checks: [
          usedTool('search_products'),
          showsProducts(2),
          everyProductInCategories(['furniture']),
          replyIsConcise(),
        ],
      },
    ],
  },
  {
    id: 'quality-intent',
    intent: '"Best rated" becomes a rating filter or rating sort',
    turns: [
      {
        prompt: 'Show me your best rated smartphones',
        checks: [
          usedTool('search_products'),
          showsProducts(2),
          everyProductInCategories(['smartphones', 'mobile-accessories', 'tablets']),
          everyProductRatedAtLeast(3.5),
        ],
      },
    ],
  },
  {
    id: 'cheapest-sort',
    intent: 'Superlatives map to a price sort',
    turns: [
      {
        prompt: 'What is the cheapest fragrance you have?',
        checks: [usedTool('search_products'), showsProducts(1), productsSortedByPriceAscending()],
      },
    ],
  },
  {
    id: 'vague-gift',
    intent: 'Vague requests still produce results plus a clarifying question',
    turns: [
      {
        prompt: 'I need a gift for someone who loves cooking, maybe around $50',
        checks: [
          usedTool('search_products'),
          showsProducts(1),
          pricesAreGrounded([50]),
          // Tone, not correctness: tracked but non-gating (see `advisory`).
          advisory(mentionsAnyOf(['?'], 'asks a follow-up question')),
          advisory(avoidsHedgingFiller()),
        ],
      },
    ],
  },
  {
    id: 'impossible-budget',
    intent: 'Unmeetable constraints are admitted rather than faked',
    turns: [
      {
        prompt: 'I want a laptop for under $20',
        checks: [
          usedTool('search_products'),
          pricesAreGrounded([20]),
          mentionsAnyOf(
            [
              "don't have",
              'do not have',
              "couldn't find",
              'could not find',
              "didn't find",
              'no matches',
              'nothing',
              'no laptops',
              "aren't any",
              'are not any',
              'cheapest',
              'starts at',
              'start at',
              'lowest',
              'above',
              'over $',
              'more than',
              'unfortunately',
              'sorry',
            ],
            'admits the budget cannot be met',
          ),
        ],
      },
    ],
  },
  {
    id: 'brand-request',
    intent: 'Brand names are honoured',
    turns: [
      {
        prompt: 'Do you have anything from Apple?',
        checks: [usedTool('search_products'), showsProducts(1), includesProductTitled('apple')],
      },
    ],
  },
  {
    id: 'multi-intent',
    intent: 'Two requests in one message become two searches, each with its own budget',
    turns: [
      {
        prompt: 'I need a laptop under $1500 and a pair of sunglasses under $50',
        checks: [
          searchedSeparatelyFor(['laptop', 'sunglass']),
          showsCardGroups(2),
          coversCategories(['laptops', 'sunglasses']),
          everyProductUnder(1500),
          pricesAreGrounded([1500, 50]),
          mentionsAnyOf(['sunglass'], 'the reply covers the second request too'),
        ],
      },
      {
        // References must resolve inside a group, since each list restarts at 1.
        prompt: 'Tell me more about the second laptop',
        checks: [usedTool('get_product_details'), showsProducts(1), namedProductsWereRetrieved()],
      },
    ],
  },
  {
    id: 'single-product-conjunction',
    intent: '"and" inside a product name stays one search',
    turns: [
      {
        prompt: 'Do you have a shampoo and conditioner?',
        checks: [usedTool('search_products'), showsProducts(1), replyIsConcise()],
      },
    ],
  },
  {
    id: 'follow-up-reference',
    intent: 'Follow-up references resolve against the products already shown',
    turns: [
      {
        prompt: 'Show me two laptops',
        checks: [usedTool('search_products'), showsProducts(1)],
      },
      {
        prompt: 'Tell me more about the first one — what is the warranty?',
        checks: [
          usedTool('get_product_details'),
          showsProducts(1),
          mentionsAnyOf(['warranty', 'month', 'year'], 'answers with warranty information'),
          namedProductsWereRetrieved(),
        ],
      },
    ],
  },
  {
    id: 'refinement',
    intent: 'A refinement re-runs retrieval with the new constraint',
    turns: [
      {
        prompt: 'I am looking for sunglasses',
        checks: [usedTool('search_products'), showsProducts(1)],
      },
      {
        prompt: 'Anything cheaper than $30?',
        checks: [usedTool('search_products'), everyProductUnder(30), pricesAreGrounded([30])],
      },
    ],
  },
  {
    id: 'catalog-question',
    intent: 'Questions about the catalog itself are answered from the category list',
    turns: [
      {
        prompt: 'What types of products do you sell?',
        checks: [mentionsAnyOf(['beaut', 'furniture', 'grocer', 'laptop', 'categor'])],
      },
    ],
  },
  {
    id: 'off-topic',
    intent: 'Unrelated requests are redirected instead of answered with products',
    turns: [
      {
        prompt: 'What is the weather in Tel Aviv tomorrow?',
        checks: [
          showsNoProducts(),
          mentionsAnyOf(
            ['shop', 'product', 'catalog', 'help you find', 'store', "can't", 'cannot', 'unable'],
            'redirects to shopping',
          ),
          replyIsConcise(60),
        ],
      },
    ],
  },
];
