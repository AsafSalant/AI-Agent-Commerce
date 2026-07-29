import type { Product, ToolTraceEntry } from '@shopping-copilot/shared';

/** Everything one agent turn produced, flattened for assertions. */
export interface TurnResult {
  text: string;
  products: Product[];
  widgetCount: number;
  toolTrace: ToolTraceEntry[];
}

export interface CheckOutcome {
  name: string;
  pass: boolean;
  detail: string;
  /** Reported and tracked, but does not gate the suite. See `advisory`. */
  advisory?: boolean;
}

export type Check = (turn: TurnResult) => CheckOutcome;

/**
 * Marks a check as non-gating.
 *
 * Correctness properties — the right tool ran, the returned products respect
 * the stated budget, nothing was invented — must hold on every run, and a
 * failure there is a real regression. Tone and phrasing are different: the
 * model will satisfy "end with a question" and "do not hedge" on most runs but
 * trade one against the other on some, and forcing them into the same gate
 * would train everyone to ignore a red suite. Advisory checks stay visible in
 * the report without failing the build.
 */
export function advisory(check: Check): Check {
  return (turn) => ({ ...check(turn), advisory: true });
}

const ok = (name: string, detail = ''): CheckOutcome => ({ name, pass: true, detail });
const fail = (name: string, detail: string): CheckOutcome => ({ name, pass: false, detail });

export function usedTool(tool: string): Check {
  return (turn) => {
    const names = turn.toolTrace.map((entry) => entry.name);
    return names.includes(tool)
      ? ok(`calls ${tool}`, names.join(', '))
      : fail(`calls ${tool}`, `tools used: ${names.join(', ') || 'none'}`);
  };
}

export function showsProducts(minimum = 1): Check {
  return (turn) =>
    turn.products.length >= minimum
      ? ok(`shows >=${minimum} products`, `${turn.products.length} products`)
      : fail(`shows >=${minimum} products`, `only ${turn.products.length}`);
}

/**
 * Each card group is one retrieval, so this asserts the agent decomposed a
 * multi-intent message instead of collapsing it into a single blended search.
 */
export function showsCardGroups(minimum: number): Check {
  return (turn) =>
    turn.widgetCount >= minimum
      ? ok(`shows >=${minimum} card groups`, `${turn.widgetCount} groups`)
      : fail(`shows >=${minimum} card groups`, `only ${turn.widgetCount}`);
}

/** Every listed item must be the subject of its own search, not one merged query. */
export function searchedSeparatelyFor(items: string[]): Check {
  const name = `searches separately for ${items.join(' / ')}`;
  return (turn) => {
    const searches = turn.toolTrace
      .filter((entry) => entry.name === 'search_products')
      .map((entry) => JSON.stringify(entry.args).toLowerCase());

    const missing = items.filter(
      (item) => !searches.some((search) => search.includes(item.toLowerCase())),
    );
    const merged = searches.filter(
      (search) => items.filter((item) => search.includes(item.toLowerCase())).length > 1,
    );

    if (missing.length > 0) {
      return fail(name, `no search mentions ${missing.join(', ')}; calls: ${searches.join(' | ') || 'none'}`);
    }
    return merged.length === 0
      ? ok(name, searches.join(' | '))
      : fail(name, `one search covered several items: ${merged.join(' | ')}`);
  };
}

export function showsNoProducts(): Check {
  return (turn) =>
    turn.products.length === 0
      ? ok('shows no products')
      : fail('shows no products', `${turn.products.length} products were rendered`);
}

export function everyProductUnder(maxPrice: number): Check {
  return (turn) => {
    const over = turn.products.filter((product) => product.finalPrice > maxPrice);
    return over.length === 0
      ? ok(`all products <= $${maxPrice}`)
      : fail(
          `all products <= $${maxPrice}`,
          over.map((product) => `${product.title} $${product.finalPrice}`).join('; '),
        );
  };
}

export function everyProductInCategories(categories: string[]): Check {
  return (turn) => {
    const wrong = turn.products.filter((product) => !categories.includes(product.category));
    return wrong.length === 0
      ? ok(`all products in ${categories.join('/')}`)
      : fail(
          `all products in ${categories.join('/')}`,
          wrong.map((product) => `${product.title} (${product.category})`).join('; '),
        );
  };
}

/** At least one retrieved product per listed category, so no intent came back empty. */
export function coversCategories(categories: string[]): Check {
  return (turn) => {
    const present = new Set(turn.products.map((product) => product.category));
    const missing = categories.filter(
      (category) => ![...present].some((found) => found.includes(category)),
    );
    return missing.length === 0
      ? ok(`covers ${categories.join(' + ')}`, [...present].join(', '))
      : fail(`covers ${categories.join(' + ')}`, `nothing from ${missing.join(', ')}`);
  };
}

export function everyProductRatedAtLeast(minRating: number): Check {
  return (turn) => {
    const low = turn.products.filter((product) => product.rating < minRating);
    return low.length === 0
      ? ok(`all products rated >= ${minRating}`)
      : fail(
          `all products rated >= ${minRating}`,
          low.map((product) => `${product.title} ${product.rating}`).join('; '),
        );
  };
}

export function productsSortedByPriceAscending(): Check {
  return (turn) => {
    const prices = turn.products.map((product) => product.finalPrice);
    const sorted = [...prices].sort((a, b) => a - b);
    return prices.join() === sorted.join()
      ? ok('cheapest first')
      : fail('cheapest first', prices.join(', '));
  };
}

/**
 * Models reply with typographic punctuation, so `couldn’t` would never match a
 * literal `couldn't`. Fold those characters before comparing.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-');
}

export function mentionsAnyOf(phrases: string[], label = 'mentions expected wording'): Check {
  return (turn) => {
    const text = normalize(turn.text);
    const hit = phrases.find((phrase) => text.includes(normalize(phrase)));
    return hit ? ok(label, `matched "${hit}"`) : fail(label, `text: ${turn.text.slice(0, 160)}`);
  };
}

export function includesProductTitled(fragment: string): Check {
  return (turn) => {
    const match = turn.products.find((product) =>
      product.title.toLowerCase().includes(fragment.toLowerCase()),
    );
    return match
      ? ok(`returns a product matching "${fragment}"`, match.title)
      : fail(
          `returns a product matching "${fragment}"`,
          turn.products.map((product) => product.title).join('; ') || 'no products',
        );
  };
}

/**
 * "If you want, I can narrow it down…" is the model's favourite way to fill
 * space without actually asking anything. A question the shopper can answer is
 * more useful, so the wording is asserted rather than hoped for.
 */
export function avoidsHedgingFiller(): Check {
  const fillers = ['if you want, i can', 'if you like, i can', 'let me know if you', 'i can also'];
  return (turn) => {
    const text = normalize(turn.text);
    const hit = fillers.find((filler) => text.includes(filler));
    return hit
      ? fail('avoids hedging filler', `used "${hit}"`)
      : ok('avoids hedging filler');
  };
}

export function replyIsConcise(maxWords = 90): Check {
  return (turn) => {
    const words = turn.text.trim().split(/\s+/).filter(Boolean).length;
    return words <= maxWords
      ? ok(`reply <= ${maxWords} words`, `${words} words`)
      : fail(`reply <= ${maxWords} words`, `${words} words`);
  };
}

/**
 * Hallucination guard: every dollar amount the assistant says out loud must
 * belong to a product that was actually retrieved (or be a budget figure the
 * shopper themselves mentioned).
 */
export function pricesAreGrounded(shopperFigures: number[] = []): Check {
  return (turn) => {
    const quoted = [...turn.text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)].map((match) =>
      Number(match[1].replace(/,/g, '')),
    );
    if (quoted.length === 0) return ok('quoted prices are grounded', 'no prices quoted');

    const allowed = [
      ...shopperFigures,
      ...turn.products.flatMap((product) => [product.price, product.finalPrice]),
    ];
    const invented = quoted.filter(
      (value) => !allowed.some((candidate) => Math.abs(candidate - value) < 1.01),
    );

    return invented.length === 0
      ? ok('quoted prices are grounded', `${quoted.length} price(s) checked`)
      : fail('quoted prices are grounded', `not in catalog: ${invented.map((v) => `$${v}`).join(', ')}`);
  };
}

/** Titles the assistant names must come from the retrieved set. */
export function namedProductsWereRetrieved(): Check {
  return (turn) => {
    if (turn.products.length === 0) return ok('named products were retrieved', 'no products');
    const text = turn.text.toLowerCase();
    // Brands are the most common way the model refers to a product.
    const brands = [...new Set(turn.products.map((product) => product.brand).filter(Boolean))].map(
      (brand) => (brand as string).toLowerCase(),
    );
    const suspiciousBrands = ['samsung', 'sony', 'dell', 'hp', 'nike', 'adidas', 'bose'].filter(
      (brand) => text.includes(brand) && !brands.includes(brand),
    );

    return suspiciousBrands.length === 0
      ? ok('named products were retrieved')
      : fail('named products were retrieved', `mentions unretrieved brand(s): ${suspiciousBrands.join(', ')}`);
  };
}
