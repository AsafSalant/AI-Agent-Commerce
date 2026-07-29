import { createTool } from '@mastra/core/tools';
import { randomUUID } from 'node:crypto';
import type { ProductSearchFilters, ProductSearchResult } from '@shopping-copilot/shared';
import { toModelProduct } from '../products/product.mapper';
import type { ProductsService } from '../products/products.service';
import type { ToolOutcome } from './agent.types';
import { dataBlock } from './sanitize';
import { noArgsSchema, productDetailsArgsSchema, searchProductsArgsSchema } from './tool.schemas';

export const SEARCH_PRODUCTS = 'search_products';
export const GET_PRODUCT_DETAILS = 'get_product_details';
export const LIST_CATEGORIES = 'list_categories';

/** Only the compact `model` string crosses back to the model; the rest is ours. */
const toModelOutput = (outcome: unknown) => ({
  type: 'text' as const,
  value: (outcome as ToolOutcome).model,
});

/**
 * The catalog surface the agent can reach. A factory rather than a module
 * constant because the tools close over the injected `ProductsService`, which
 * keeps retrieval, caching and the DummyJSON client under Nest DI.
 */
export function createShoppingTools(products: ProductsService) {
  const search = createTool({
    id: SEARCH_PRODUCTS,
    description:
      'Search the store catalog for products matching the shopper. Returns products that are ' +
      'automatically rendered as product cards in the chat UI. Call this before recommending anything.',
    inputSchema: searchProductsArgsSchema,
    toModelOutput,
    execute: async (args): Promise<ToolOutcome> => {
      const filters: ProductSearchFilters = {
        query: args.query,
        category: args.category,
        brand: args.brand,
        minPrice: args.min_price,
        maxPrice: args.max_price,
        minRating: args.min_rating,
        tags: args.tags,
        inStockOnly: args.in_stock_only,
        sortBy: args.sort_by,
        order: args.order,
        limit: args.limit,
      };

      try {
        const result = await products.search(filters);
        return {
          model: dataBlock(
            'product_data',
            JSON.stringify({
              count: result.products.length,
              total_matches: result.total,
              filters_applied: result.filters,
              notes: result.notes,
              rendered_as_cards: result.products.length > 0,
              products: result.products.map(toModelProduct),
            }),
          ),
          ...(result.products.length > 0
            ? {
                widget: {
                  type: 'product_list' as const,
                  id: randomUUID(),
                  heading: buildHeading(result),
                  products: result.products,
                  total: result.total,
                  filters: result.filters,
                },
              }
            : {}),
          resultCount: result.products.length,
          statusLabel: searchStatusLabel(result),
        };
      } catch (error) {
        return catalogFailure(error, 'Searching the catalog');
      }
    },
  });

  const details = createTool({
    id: GET_PRODUCT_DETAILS,
    description:
      'Fetch full details (warranty, shipping, return policy, stock, reviews) for one product ' +
      'the shopper asked about. Also renders its card in the chat.',
    inputSchema: productDetailsArgsSchema,
    toModelOutput,
    execute: async (args): Promise<ToolOutcome> => {
      try {
        const product = await products.getProduct(args.product_id);
        return {
          model: dataBlock(
            'product_data',
            JSON.stringify({
              product: {
                ...toModelProduct(product),
                availabilityStatus: product.availabilityStatus,
                warrantyInformation: product.warrantyInformation,
                shippingInformation: product.shippingInformation,
                returnPolicy: product.returnPolicy,
                reviewCount: product.reviewCount,
                sku: product.sku,
              },
              rendered_as_cards: true,
            }),
          ),
          widget: {
            type: 'product_list',
            id: randomUUID(),
            heading: product.title,
            products: [product],
            total: 1,
            filters: { limit: 1 },
          },
          resultCount: 1,
          statusLabel: `Retrieved ${product.title}`,
        };
      } catch (error) {
        return catalogFailure(error, 'Looking up a product');
      }
    },
  });

  const categories = createTool({
    id: LIST_CATEGORIES,
    description:
      'List the catalog category names. Only for a shopper who names no product type at all ' +
      '("what do you sell?", "what categories do you have?"). If they name any product type — ' +
      '"what kind of furniture do you sell?", "do you have laptops?" — use search_products ' +
      'instead, because they want to see the products, not a list of words.',
    inputSchema: noArgsSchema,
    toModelOutput,
    execute: async (): Promise<ToolOutcome> => {
      try {
        const found = await products.getCategories();
        return {
          model: dataBlock('product_data', JSON.stringify({ categories: found })),
          resultCount: found.length,
          statusLabel: `Retrieved ${found.length} categories`,
        };
      } catch (error) {
        return catalogFailure(error, 'Checking catalog categories');
      }
    },
  });

  return {
    [SEARCH_PRODUCTS]: search,
    [GET_PRODUCT_DETAILS]: details,
    [LIST_CATEGORIES]: categories,
  };
}

/**
 * How a call reads while it is still in flight. Only the model's arguments are
 * available this early, which is enough to name what is being looked for.
 */
export function describeToolCall(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case SEARCH_PRODUCTS: {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      const category = typeof args.category === 'string' ? args.category.trim() : '';
      if (query) return `Searching the catalog for “${query}”`;
      if (category) return `Browsing ${titleCase(category)}`;
      return 'Searching the catalog';
    }
    case GET_PRODUCT_DETAILS:
      return 'Looking up product details';
    case LIST_CATEGORIES:
      return 'Retrieving categories';
    default:
      return `Running ${toolName.replace(/_/g, ' ')}`;
  }
}

/**
 * A catalog outage is reported to the model as a tool result rather than thrown,
 * so the turn ends with the agent telling the shopper what happened.
 */
function catalogFailure(error: unknown, statusLabel: string): ToolOutcome {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    model: JSON.stringify({
      error: `The catalog request failed: ${reason}. Tell the shopper you could not reach the catalog.`,
    }),
    resultCount: 0,
    statusLabel: `${statusLabel} failed`,
    error: reason,
  };
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildHeading(result: ProductSearchResult): string {
  const { query, category, maxPrice, minPrice, sortBy } = result.filters;
  let heading: string;

  if (query && category) heading = `“${query}” in ${titleCase(category)}`;
  else if (query) heading = `Results for “${query}”`;
  else if (category) heading = `${titleCase(category)} picks`;
  else if (sortBy === 'discount') heading = 'Best deals right now';
  else heading = 'Popular picks';

  if (maxPrice !== undefined) heading += ` · under $${maxPrice}`;
  else if (minPrice !== undefined) heading += ` · from $${minPrice}`;

  return heading;
}

function searchStatusLabel(result: ProductSearchResult): string {
  const { query, category } = result.filters;
  const count = result.products.length;
  let where: string;

  if (query) where = `for “${query}”`;
  else if (category) where = `in ${titleCase(category)}`;
  else where = 'in the catalog';

  if (count === 0) return `No matches ${where}`;
  return `Found ${count} product${count === 1 ? '' : 's'} ${where}`;
}
