/** Sort strategies exposed to the agent and the product API. */
export const PRODUCT_SORT_FIELDS = ['relevance', 'price', 'rating', 'discount', 'title'] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

export type SortOrder = 'asc' | 'desc';

/** A single catalog product, normalised for rendering in the chat. */
export interface Product {
  id: number;
  title: string;
  description: string;
  category: string;
  brand: string | null;
  price: number;
  discountPercentage: number;
  /** Price after `discountPercentage`, rounded to cents. */
  finalPrice: number;
  rating: number;
  stock: number;
  availabilityStatus: string | null;
  tags: string[];
  thumbnail: string;
  images: string[];
  sku: string | null;
  warrantyInformation: string | null;
  shippingInformation: string | null;
  returnPolicy: string | null;
  reviewCount: number;
}

export interface ProductCategory {
  slug: string;
  name: string;
}

/**
 * Retrieval parameters. DummyJSON only supports free-text search, category
 * lookups and pagination, so price/rating/brand narrowing is applied locally
 * on top of the API response.
 */
export interface ProductSearchFilters {
  query?: string;
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  tags?: string[];
  inStockOnly?: boolean;
  sortBy?: ProductSortField;
  order?: SortOrder;
  limit?: number;
}

/** Which DummyJSON endpoint produced the candidate set. */
export type ProductSearchSource = 'search' | 'category' | 'catalog';

export interface ProductSearchResult {
  products: Product[];
  /** Matches found before `limit` was applied. */
  total: number;
  /** Filters actually used, after normalisation (e.g. category slug fixes). */
  filters: ProductSearchFilters;
  source: ProductSearchSource;
  /** Human readable notes, e.g. when a category name could not be resolved. */
  notes: string[];
}
