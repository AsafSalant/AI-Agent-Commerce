import type { Product } from '@shopping-copilot/shared';
import { looksLikeSeparateItems, scoreProduct, tokenize } from './relevance';

function product(overrides: Partial<Product>): Product {
  return {
    id: 1,
    title: 'Product',
    description: '',
    category: 'misc',
    brand: null,
    price: 10,
    discountPercentage: 0,
    finalPrice: 10,
    rating: 4,
    stock: 5,
    availabilityStatus: 'In Stock',
    tags: [],
    thumbnail: 'https://cdn.example.com/thumb.webp',
    images: [],
    sku: null,
    warrantyInformation: null,
    shippingInformation: null,
    returnPolicy: null,
    reviewCount: 0,
    ...overrides,
  };
}

describe('tokenize', () => {
  it('drops filler words that carry no retrieval signal', () => {
    expect(tokenize('show me something nice for the kitchen')).toEqual(['kitchen']);
  });
});

describe('scoreProduct', () => {
  it('reports which tokens matched', () => {
    const { matched } = scoreProduct(
      product({ title: 'Gaming Laptop X1', category: 'laptops' }),
      ['gaming', 'laptop', 'unmatched'],
    );

    expect(matched).toEqual(['gaming', 'laptop']);
  });

  it('prefers a product that answers the whole query over a stronger partial match', () => {
    const tokens = tokenize('wireless earbuds');

    const earbuds = scoreProduct(
      product({
        title: 'Soundcore Q30',
        category: 'mobile-accessories',
        tags: ['wireless', 'earbuds'],
      }),
      tokens,
    );
    // Matches "wireless" in the title, tags and description, but is not earbuds.
    const chargingPad = scoreProduct(
      product({
        title: 'Wireless Charging Pad',
        category: 'mobile-accessories',
        tags: ['wireless'],
        description: 'Wireless charging for phones.',
      }),
      tokens,
    );

    expect(earbuds.score).toBeGreaterThan(chargingPad.score);
  });

  it('falls back to rating when there is nothing to match', () => {
    const { score, matched } = scoreProduct(product({ rating: 5 }), []);

    expect(score).toBe(1);
    expect(matched).toEqual([]);
  });
});

describe('looksLikeSeparateItems', () => {
  it('flags tokens that never co-occur in one product', () => {
    expect(looksLikeSeparateItems([['laptop'], ['laptop'], ['headphones']])).toBe(true);
  });

  it('accepts a query some product satisfies in full', () => {
    expect(looksLikeSeparateItems([['salt', 'pepper'], ['salt'], ['pepper']])).toBe(false);
  });

  it('stays quiet when only one token is matchable at all', () => {
    expect(looksLikeSeparateItems([['laptop'], ['laptop']])).toBe(false);
    expect(looksLikeSeparateItems([])).toBe(false);
  });
});
