import type { Product } from '@shopping-copilot/shared';
import type { DummyJsonProduct } from './dummyjson.types';

const PLACEHOLDER_THUMBNAIL = 'https://dummyjson.com/image/300x300/eeeeee?text=No+image';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toProduct(raw: DummyJsonProduct): Product {
  const price = typeof raw.price === 'number' ? raw.price : 0;
  const discountPercentage = typeof raw.discountPercentage === 'number' ? raw.discountPercentage : 0;

  return {
    id: raw.id,
    title: raw.title ?? 'Untitled product',
    description: raw.description ?? '',
    category: raw.category ?? 'uncategorized',
    brand: raw.brand ?? null,
    price: round2(price),
    discountPercentage: round2(discountPercentage),
    finalPrice: round2(price * (1 - discountPercentage / 100)),
    rating: typeof raw.rating === 'number' ? round2(raw.rating) : 0,
    stock: typeof raw.stock === 'number' ? raw.stock : 0,
    availabilityStatus: raw.availabilityStatus ?? null,
    tags: raw.tags ?? [],
    thumbnail: raw.thumbnail ?? raw.images?.[0] ?? PLACEHOLDER_THUMBNAIL,
    images: raw.images ?? [],
    sku: raw.sku ?? null,
    warrantyInformation: raw.warrantyInformation ?? null,
    shippingInformation: raw.shippingInformation ?? null,
    returnPolicy: raw.returnPolicy ?? null,
    reviewCount: raw.reviews?.length ?? 0,
  };
}

/** Compact projection handed back to the model, to keep tool results cheap. */
export function toModelProduct(product: Product) {
  return {
    id: product.id,
    title: product.title,
    brand: product.brand,
    category: product.category,
    price: product.price,
    finalPrice: product.finalPrice,
    discountPercentage: product.discountPercentage,
    rating: product.rating,
    stock: product.stock,
    tags: product.tags.slice(0, 4),
    description: product.description.length > 160
      ? `${product.description.slice(0, 157)}...`
      : product.description,
  };
}
