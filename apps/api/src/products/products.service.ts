import { Injectable, Logger } from '@nestjs/common';
import type {
  Product,
  ProductCategory,
  ProductSearchFilters,
  ProductSearchResult,
  ProductSearchSource,
} from '@shopping-copilot/shared';
import { DummyJsonClient } from './dummyjson.client';
import { toProduct } from './product.mapper';
import { looksLikeSeparateItems, scoreProduct, tokenize } from './relevance';

export const DEFAULT_SEARCH_LIMIT = 6;
export const MAX_SEARCH_LIMIT = 12;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Retrieval layer over the DummyJSON catalog.
 *
 * DummyJSON supports free-text search, category listings and pagination but no
 * price/rating/brand filtering or relevance control, so this service combines
 * the API's candidate sets with local scoring and narrowing.
 */
@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly client: DummyJsonClient) {}

  async getCategories(): Promise<ProductCategory[]> {
    const categories = await this.client.getCategories();
    return categories.map(({ slug, name }) => ({ slug, name }));
  }

  async getProduct(id: number): Promise<Product> {
    return toProduct(await this.client.getProduct(id));
  }

  /** Resolves loose category wording ("phones", "Men's Shirts") to a real slug. */
  async resolveCategory(input: string): Promise<string | null> {
    const categories = await this.getCategories();
    const needle = slugify(input);
    if (!needle) return null;

    const exact = categories.find(
      (category) => category.slug === needle || slugify(category.name) === needle,
    );
    if (exact) return exact.slug;

    const singular = needle.replace(/s$/, '');
    const partial = categories.find((category) => {
      const slug = category.slug;
      return (
        slug.includes(needle) ||
        needle.includes(slug) ||
        (singular.length > 2 && (slug.includes(singular) || slug.replace(/s$/, '') === singular))
      );
    });
    return partial?.slug ?? null;
  }

  async search(filters: ProductSearchFilters): Promise<ProductSearchResult> {
    const notes: string[] = [];
    const limit = clamp(Math.round(filters.limit ?? DEFAULT_SEARCH_LIMIT), 1, MAX_SEARCH_LIMIT);
    const query = filters.query?.trim() ? filters.query.trim() : undefined;

    let category: string | undefined;
    if (filters.category?.trim()) {
      const resolved = await this.resolveCategory(filters.category);
      if (resolved) {
        category = resolved;
      } else {
        notes.push(
          `There is no "${filters.category}" category in the catalog, so the whole catalog was searched instead.`,
        );
      }
    }

    const { candidates, source } = await this.collectCandidates(query, category);
    const tokens = query ? tokenize(query) : [];

    let ranked = candidates.map((product) => {
      const { score, matched } = scoreProduct(product, tokens);
      return { product, relevance: score, matched };
    });

    // Inside a category browse, a query narrows the set only when it matches
    // something; otherwise it just falls back to the category's best products.
    if (tokens.length > 0) {
      const matching = ranked.filter((entry) => entry.matched.length > 0);
      if (matching.length > 0) {
        ranked = matching;
        if (looksLikeSeparateItems(matching.map((entry) => entry.matched))) {
          notes.push(
            `No single product matches all of "${query}". If the shopper asked for more than one kind ` +
              `of item, search for each item separately — one search cannot hold two budgets or split ` +
              `its result slots between them.`,
          );
        }
      } else if (category) {
        notes.push(
          `Nothing in "${category}" matched "${query}", so the category's top-rated products are shown.`,
        );
      }
    }

    const normalized: ProductSearchFilters = {
      ...filters,
      query,
      category,
      limit,
      sortBy: filters.sortBy ?? (tokens.length > 0 ? 'relevance' : 'rating'),
    };

    let matched = ranked.filter((entry) => this.matchesFilters(entry.product, normalized));

    if (matched.length === 0 && ranked.length > 0) {
      matched = this.relax(ranked, normalized, notes);
    }

    const sorted = this.sort(matched, normalized);

    return {
      products: sorted.slice(0, limit).map((entry) => entry.product),
      total: sorted.length,
      filters: normalized,
      source,
      notes,
    };
  }

  private async collectCandidates(
    query: string | undefined,
    category: string | undefined,
  ): Promise<{ candidates: Product[]; source: ProductSearchSource }> {
    if (category) {
      const list = await this.client.getProductsByCategory(category);
      return { candidates: list.products.map(toProduct), source: 'category' };
    }

    const catalog = (await this.client.getAllProducts()).products.map(toProduct);

    if (!query) {
      return { candidates: catalog, source: 'catalog' };
    }

    // Union of the API's own search hits and locally scored catalog matches:
    // DummyJSON's search recall is narrow, local scoring covers the rest.
    const byId = new Map<number, Product>();
    try {
      const hits = await this.client.searchProducts(query);
      for (const raw of hits.products) {
        const product = toProduct(raw);
        byId.set(product.id, product);
      }
    } catch (error) {
      this.logger.warn(
        `Falling back to local matching for "${query}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const tokens = tokenize(query);
    for (const product of catalog) {
      if (scoreProduct(product, tokens).matched.length > 0) {
        byId.set(product.id, product);
      }
    }

    return { candidates: [...byId.values()], source: 'search' };
  }

  private matchesFilters(product: Product, filters: ProductSearchFilters): boolean {
    if (filters.minPrice !== undefined && product.finalPrice < filters.minPrice) return false;
    if (filters.maxPrice !== undefined && product.finalPrice > filters.maxPrice) return false;
    if (filters.minRating !== undefined && product.rating < filters.minRating) return false;
    if (filters.inStockOnly && product.stock <= 0) return false;

    if (filters.brand) {
      const brand = (product.brand ?? '').toLowerCase();
      if (!brand.includes(filters.brand.toLowerCase())) return false;
    }

    if (filters.tags?.length) {
      const tags = product.tags.map((tag) => tag.toLowerCase());
      const wanted = filters.tags.map((tag) => tag.toLowerCase());
      if (!wanted.some((tag) => tags.some((productTag) => productTag.includes(tag)))) return false;
    }

    return true;
  }

  /**
   * When strict filtering wipes out every candidate we return the closest
   * alternatives plus a note, so the agent can say "nothing under $20, but…"
   * instead of dead-ending the conversation.
   */
  private relax<T extends { product: Product }>(
    ranked: T[],
    filters: ProductSearchFilters,
    notes: string[],
  ): T[] {
    const withoutPrice: ProductSearchFilters = {
      ...filters,
      minPrice: undefined,
      maxPrice: undefined,
    };
    const hasPriceFilter = filters.minPrice !== undefined || filters.maxPrice !== undefined;

    if (hasPriceFilter) {
      const relaxed = ranked.filter((entry) => this.matchesFilters(entry.product, withoutPrice));
      if (relaxed.length > 0) {
        const range = [
          filters.minPrice !== undefined ? `above $${filters.minPrice}` : null,
          filters.maxPrice !== undefined ? `under $${filters.maxPrice}` : null,
        ]
          .filter(Boolean)
          .join(' and ');
        notes.push(
          `No match ${range}; the closest options by price are shown instead. Tell the user the price range could not be met.`,
        );
        const ascending = filters.maxPrice !== undefined;
        return [...relaxed].sort((a, b) =>
          ascending
            ? a.product.finalPrice - b.product.finalPrice
            : b.product.finalPrice - a.product.finalPrice,
        );
      }
    }

    if (filters.minRating !== undefined) {
      const relaxed = ranked.filter((entry) =>
        this.matchesFilters(entry.product, { ...withoutPrice, minRating: undefined }),
      );
      if (relaxed.length > 0) {
        notes.push(
          `No product met the rating and price constraints; the best rated close matches are shown instead.`,
        );
        return [...relaxed].sort((a, b) => b.product.rating - a.product.rating);
      }
    }

    return [];
  }

  private sort<T extends { product: Product; relevance: number }>(
    entries: T[],
    filters: ProductSearchFilters,
  ): T[] {
    const sortBy = filters.sortBy ?? 'relevance';
    const defaultOrder = sortBy === 'price' || sortBy === 'title' ? 'asc' : 'desc';
    const direction = (filters.order ?? defaultOrder) === 'asc' ? 1 : -1;

    const value = (entry: T): number | string => {
      switch (sortBy) {
        case 'price':
          return entry.product.finalPrice;
        case 'rating':
          return entry.product.rating;
        case 'discount':
          return entry.product.discountPercentage;
        case 'title':
          return entry.product.title.toLowerCase();
        case 'relevance':
        default:
          return entry.relevance;
      }
    };

    return [...entries].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left).localeCompare(String(right)) * direction;
      }
      if (left === right) {
        return b.product.rating - a.product.rating;
      }
      return (left - right) * direction;
    });
  }
}
