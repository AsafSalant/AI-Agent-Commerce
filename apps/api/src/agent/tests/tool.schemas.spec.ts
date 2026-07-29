import { MAX_SEARCH_LIMIT } from '../../products/products.service';
import { productDetailsArgsSchema, searchProductsArgsSchema } from '../tool.schemas';

function search(args: Record<string, unknown>) {
  return searchProductsArgsSchema.parse(args);
}

describe('searchProductsArgsSchema', () => {
  it('takes prices the model wrote as currency strings', () => {
    expect(search({ max_price: '$1,200' }).max_price).toBe(1200);
    expect(search({ min_price: '50' }).min_price).toBe(50);
  });

  it('drops a price the model described in words instead of digits', () => {
    // "cheap" strips to an empty string, which Number() reads as 0 — a $0
    // ceiling would match nothing and the shopper would be told the catalog
    // is empty. No filter at all is the honest answer.
    expect(search({ max_price: 'cheap' }).max_price).toBeUndefined();
    expect(search({ min_price: 'expensive' }).min_price).toBeUndefined();
  });

  it('drops a price string that is not a single number', () => {
    expect(search({ max_price: '1.2.3' }).max_price).toBeUndefined();
  });

  it('splits a comma-separated tag string into a list', () => {
    expect(search({ tags: 'wireless, portable' }).tags).toEqual(['wireless', 'portable']);
  });

  it('rejects a rating outside the five-point scale, so the model can retry', () => {
    expect(() => search({ min_rating: 42 })).toThrow();
    expect(search({ min_rating: '4' }).min_rating).toBe(4);
  });

  it('rejects a limit beyond what the catalog will return', () => {
    expect(() => search({ limit: MAX_SEARCH_LIMIT + 1 })).toThrow();
    expect(search({ limit: `${MAX_SEARCH_LIMIT}` }).limit).toBe(MAX_SEARCH_LIMIT);
  });

  it('accepts an empty call, which browses the catalog', () => {
    expect(search({})).toEqual({});
  });
});

describe('productDetailsArgsSchema', () => {
  it('takes an id the model wrote as a string', () => {
    expect(productDetailsArgsSchema.parse({ product_id: '4' }).product_id).toBe(4);
  });

  it('rejects an id that is not a positive integer', () => {
    expect(() => productDetailsArgsSchema.parse({ product_id: 0 })).toThrow();
    expect(() => productDetailsArgsSchema.parse({ product_id: 'the blue one' })).toThrow();
  });
});
