import type { DummyJsonClient } from './dummyjson.client';
import { ProductsService } from './products.service';
import { FakeDummyJsonClient } from '../../test/fakes/fake-dummyjson.client';

describe('ProductsService', () => {
  let client: FakeDummyJsonClient;
  let service: ProductsService;

  beforeEach(() => {
    client = new FakeDummyJsonClient();
    service = new ProductsService(client as unknown as DummyJsonClient);
  });

  describe('search', () => {
    it('finds products whose description matches, beyond the API\'s own search recall', async () => {
      // The fake API only matches titles, so "mascara" is found by local scoring.
      const result = await service.search({ query: 'mascara' });

      expect(result.products.map((product) => product.id)).toContain(5);
      expect(result.source).toBe('search');
    });

    it('ranks title matches above description matches', async () => {
      const result = await service.search({ query: 'chromebook laptop' });

      expect(result.products[0].id).toBe(3);
    });

    it('applies a budget to the discounted price', async () => {
      // MacBook lists at $2000 but costs $1800 after its 10% discount.
      const result = await service.search({ query: 'laptop', maxPrice: 1800 });

      expect(result.products.map((product) => product.id)).toEqual(
        expect.arrayContaining([1, 2, 3]),
      );
      expect(result.products.every((product) => product.finalPrice <= 1800)).toBe(true);
    });

    it('filters by brand, rating and stock', async () => {
      const result = await service.search({
        query: 'laptop',
        brand: 'apple',
        minRating: 4,
        inStockOnly: true,
      });

      expect(result.products).toHaveLength(1);
      expect(result.products[0].brand).toBe('Apple');
    });

    it('resolves loose category wording to a real slug', async () => {
      const result = await service.search({ category: 'laptop' });

      expect(result.filters.category).toBe('laptops');
      expect(result.source).toBe('category');
      expect(result.products.map((product) => product.category)).toEqual([
        'laptops',
        'laptops',
        'laptops',
      ]);
    });

    it('searches the whole catalog and explains itself when a category does not exist', async () => {
      const result = await service.search({ category: 'spaceships', query: 'laptop' });

      expect(result.filters.category).toBeUndefined();
      expect(result.notes.join(' ')).toContain('spaceships');
      expect(result.products.length).toBeGreaterThan(0);
    });

    it('sorts by price ascending when asked for the cheapest', async () => {
      const result = await service.search({ category: 'laptops', sortBy: 'price' });

      const prices = result.products.map((product) => product.finalPrice);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it('sorts by rating by default when there is no query', async () => {
      const result = await service.search({});

      expect(result.filters.sortBy).toBe('rating');
      expect(result.products[0].id).toBe(4);
    });

    it('returns the closest alternatives with a note when no product fits the budget', async () => {
      const result = await service.search({ query: 'laptop', maxPrice: 50 });

      expect(result.products.length).toBeGreaterThan(0);
      expect(result.notes.join(' ')).toContain('No match under $50');
      // Cheapest first, so the agent can quote the closest option.
      expect(result.products[0].finalPrice).toBeLessThanOrEqual(result.products[1].finalPrice);
    });

    it('caps the number of returned products but reports the full match count', async () => {
      const result = await service.search({ limit: 2 });

      expect(result.products).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.filters.limit).toBe(2);
    });

    it('tells the agent to search separately when one query fused two items', async () => {
      const result = await service.search({ query: 'laptop mascara' });

      expect(result.notes.join(' ')).toContain('No single product matches all of "laptop mascara"');
      expect(result.notes.join(' ')).toContain('search for each item separately');
    });

    it('stays quiet when a single product satisfies the whole query', async () => {
      const result = await service.search({ query: 'apple laptop' });

      expect(result.products[0].id).toBe(1);
      expect(result.notes).toEqual([]);
    });

    it('returns no products when the query matches nothing in a category', async () => {
      const result = await service.search({ category: 'beauty', query: 'quantum' });

      expect(result.products).toEqual([]);
      expect(result.notes.join(' ')).toContain('Nothing in "beauty" matched "quantum"');
    });

    it('computes the discounted price and normalises missing fields', async () => {
      const result = await service.search({ query: 'chromebook' });
      const chromebook = result.products[0];

      expect(chromebook.finalPrice).toBe(150);
      expect(chromebook.images).toEqual([]);
      expect(chromebook.thumbnail).toContain('chromebook');
    });
  });

  describe('resolveCategory', () => {
    it.each([
      ['laptops', 'laptops'],
      ['laptop', 'laptops'],
      ['Laptops', 'laptops'],
      ['smartphone', 'smartphones'],
      ['phones', 'smartphones'],
      ['spaceships', null],
      ['', null],
    ])('maps %s to %s', async (input, expected) => {
      await expect(service.resolveCategory(input)).resolves.toBe(expected);
    });
  });

  describe('getProduct', () => {
    it('returns a normalised product', async () => {
      const product = await service.getProduct(1);

      expect(product).toMatchObject({
        id: 1,
        brand: 'Apple',
        price: 2000,
        finalPrice: 1800,
        reviewCount: 1,
      });
    });

    it('propagates a not-found error for unknown ids', async () => {
      await expect(service.getProduct(999)).rejects.toThrow('Unknown product id');
    });
  });
});
