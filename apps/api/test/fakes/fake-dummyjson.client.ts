import { NotFoundException } from '@nestjs/common';
import type { DummyJsonClient } from '../../src/products/dummyjson.client';
import type {
  DummyJsonCategory,
  DummyJsonProduct,
  DummyJsonProductList,
} from '../../src/products/dummyjson.types';
import { CATEGORY_FIXTURES, PRODUCT_FIXTURES } from '../fixtures/products.fixture';

/**
 * Stand-in for the DummyJSON API. Search deliberately matches only the title,
 * mimicking the real endpoint's narrow recall so tests cover the local
 * relevance layer that compensates for it.
 */
export class FakeDummyJsonClient implements Pick<
  DummyJsonClient,
  'getAllProducts' | 'searchProducts' | 'getProductsByCategory' | 'getCategories' | 'getProduct'
> {
  public readonly calls: string[] = [];

  constructor(
    private readonly products: DummyJsonProduct[] = PRODUCT_FIXTURES,
    private readonly categories: DummyJsonCategory[] = CATEGORY_FIXTURES,
  ) {}

  async getAllProducts(): Promise<DummyJsonProductList> {
    this.calls.push('getAllProducts');
    return this.list(this.products);
  }

  async searchProducts(query: string): Promise<DummyJsonProductList> {
    this.calls.push(`searchProducts:${query}`);
    const needle = query.toLowerCase();
    return this.list(this.products.filter((product) => product.title.toLowerCase().includes(needle)));
  }

  async getProductsByCategory(slug: string): Promise<DummyJsonProductList> {
    this.calls.push(`getProductsByCategory:${slug}`);
    return this.list(this.products.filter((product) => product.category === slug));
  }

  async getCategories(): Promise<DummyJsonCategory[]> {
    this.calls.push('getCategories');
    return this.categories;
  }

  async getProduct(id: number): Promise<DummyJsonProduct> {
    this.calls.push(`getProduct:${id}`);
    const found = this.products.find((product) => product.id === id);
    if (!found) throw new NotFoundException(`Unknown product id: ${id}`);
    return found;
  }

  private list(products: DummyJsonProduct[]): DummyJsonProductList {
    return { products, total: products.length, skip: 0, limit: products.length };
  }
}
