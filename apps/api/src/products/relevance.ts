import type { Product } from '@shopping-copilot/shared';

/**
 * Words that carry no retrieval signal in shopping requests. Dropping them
 * stops queries like "show me something nice for the kitchen" from matching
 * every product that happens to contain "for" in its description.
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'anything',
  'are',
  'around',
  'as',
  'at',
  'be',
  'best',
  'buy',
  'can',
  'cheap',
  'do',
  'find',
  'for',
  'get',
  'give',
  'good',
  'have',
  'i',
  'in',
  'is',
  'it',
  'item',
  'items',
  'like',
  'looking',
  'me',
  'my',
  'need',
  'nice',
  'of',
  'on',
  'or',
  'please',
  'product',
  'products',
  'recommend',
  'show',
  'some',
  'something',
  'suggest',
  'that',
  'the',
  'to',
  'under',
  'want',
  'what',
  'which',
  'with',
  'would',
  'you',
]);

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Naive singular form so "phones" matches "phone" and vice versa. Only strips
 * "es" when the word actually needs it for its plural (box/watch/glass style
 * endings) — otherwise "shoes" would stem to "sho", a 3-letter fragment that
 * substring-matches unrelated words like "showcases" or "shooting".
 */
function variants(token: string): string[] {
  const forms = new Set([token]);
  if (token.endsWith('ies') && token.length > 4) {
    forms.add(`${token.slice(0, -3)}y`);
  } else if (token.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(token)) {
    forms.add(token.slice(0, -2));
  } else if (token.endsWith('s') && token.length > 3) {
    forms.add(token.slice(0, -1));
  }
  forms.add(`${token}s`);
  return [...forms];
}

/**
 * Word-boundary aware "contains" check. Plain substring matching lets short
 * stemmed forms (e.g. "cat") match inside unrelated words ("category",
 * "concatenate"), so this only matches at the start of a word — enough to
 * still catch compounds like "shoe" inside "shoemaker".
 */
function includesAny(haystack: string, forms: string[]): boolean {
  return forms.some((form) => new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(form)}`).test(haystack));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface RelevanceScore {
  score: number;
  /** Which of the query tokens this product matched at all. */
  matched: string[];
}

/**
 * Field-weighted keyword score. DummyJSON's `/products/search` only matches a
 * couple of fields and returns very few hits (e.g. "laptop" yields 5), so this
 * runs over the cached catalog to widen recall for conversational phrasing.
 */
export function scoreProduct(product: Product, tokens: string[]): RelevanceScore {
  if (tokens.length === 0) {
    return { score: product.rating / 5, matched: [] };
  }

  const title = product.title.toLowerCase();
  const titleWords = new Set(title.split(/[\s-]+/));
  const brand = (product.brand ?? '').toLowerCase();
  const category = product.category.toLowerCase();
  const tags = product.tags.map((tag) => tag.toLowerCase());
  const description = product.description.toLowerCase();

  let score = 0;
  const matched: string[] = [];

  for (const token of tokens) {
    const forms = variants(token);
    let tokenScore = 0;

    if (forms.some((form) => titleWords.has(form))) tokenScore += 6;
    else if (includesAny(title, forms)) tokenScore += 4;

    if (includesAny(category, forms)) tokenScore += 3.5;
    if (tags.some((tag) => includesAny(tag, forms))) tokenScore += 3;
    if (brand && includesAny(brand, forms)) tokenScore += 3;
    if (includesAny(description, forms)) tokenScore += 1.5;

    if (tokenScore > 0) matched.push(token);
    score += tokenScore;
  }

  // Coverage weighting: a product that answers half the query is worth much
  // less than one that answers all of it, however strongly it matches its half.
  // Without this, one loud keyword match outranks a product that fits the whole
  // request.
  score *= matched.length / tokens.length;

  if (matched.length === tokens.length && tokens.length > 1) {
    score += 2;
  }
  // Small tie-breaker so equally relevant products surface the better rated one.
  score += product.rating / 10;

  return { score, matched };
}

/**
 * True when the tokens the catalog can actually match never co-occur in a single
 * product — the signature of a query that fused two separate requests ("laptop
 * and headphones"). Deciding this from the data rather than from grammar avoids
 * mistaking product names such as "salt and pepper set" for two items.
 */
export function looksLikeSeparateItems(matchesPerProduct: string[][]): boolean {
  const matchable = new Set(matchesPerProduct.flat());
  if (matchable.size < 2) return false;
  return !matchesPerProduct.some((matched) => matched.length === matchable.size);
}
