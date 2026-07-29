import { z } from 'zod';
import { MAX_SEARCH_LIMIT } from '../products/products.service';

/**
 * The argument schemas the model is asked to fill in. They double as the tool
 * documentation the model reads, which is why every field carries a
 * `describe()`, and they are permissive on purpose: a call rejected by the
 * schema costs a whole extra step, so anything we can safely coerce we coerce.
 */

/** Models occasionally emit numbers as strings, or "$1,200" — coerce defensively. */
const looseNumber = z.preprocess((value) => {
  if (typeof value === 'string') {
    // Tested before Number(), which reads an empty string as 0: a word like
    // "cheap" strips down to nothing and would otherwise become a $0 filter
    // that matches the whole catalog out of existence.
    const digits = value.replace(/[^0-9.]/g, '');
    if (!digits) return undefined;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return value;
}, z.number().nonnegative().optional());

export const searchProductsArgsSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Free-text keywords describing the product, e.g. "gaming laptop", "red lipstick". Omit when browsing a whole category.',
    ),
  category: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Catalog category to restrict to, e.g. "smartphones", "laptops", "beauty". Use only when the shopper clearly wants that category.',
    ),
  brand: z.string().trim().min(1).optional().describe('Brand name filter, e.g. "Apple".'),
  min_price: looseNumber.describe('Minimum price in USD (after discount).'),
  max_price: looseNumber.describe('Maximum price in USD (after discount). Use this for budgets.'),
  min_rating: z
    .preprocess(
      (value) => (typeof value === 'string' ? Number(value) : value),
      z.number().min(0).max(5).optional(),
    )
    .describe('Minimum average rating out of 5. Use ~4 for "best" or "highly rated".'),
  tags: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.split(',').map((tag) => tag.trim()) : value),
      z.array(z.string().min(1)).optional(),
    )
    .describe('Product tags to match, e.g. ["wireless"].'),
  in_stock_only: z
    .preprocess(
      (value) => (typeof value === 'string' ? value === 'true' : value),
      z.boolean().optional(),
    )
    .describe('Only return products in stock.'),
  sort_by: z
    .enum(['relevance', 'price', 'rating', 'discount', 'title'])
    .optional()
    .describe(
      'Ranking strategy. Use "price" for cheapest/most expensive, "rating" for best, "discount" for deals.',
    ),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z
    .preprocess(
      (value) => (typeof value === 'string' ? Number(value) : value),
      z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
    )
    .describe(`How many products to show (1-${MAX_SEARCH_LIMIT}, default 6).`),
});

export const productDetailsArgsSchema = z.object({
  product_id: z
    .preprocess(
      (value) => (typeof value === 'string' ? Number(value) : value),
      z.number().int().positive(),
    )
    .describe('Catalog id of the product.'),
});

export const noArgsSchema = z.object({});
