/** Raw shapes returned by https://dummyjson.com/products (see dummyjson_products_openapi.yaml). */
export interface DummyJsonProduct {
  id: number;
  title: string;
  description?: string;
  category?: string;
  price?: number;
  discountPercentage?: number;
  rating?: number;
  stock?: number;
  tags?: string[];
  brand?: string;
  sku?: string;
  warrantyInformation?: string;
  shippingInformation?: string;
  availabilityStatus?: string;
  returnPolicy?: string;
  reviews?: Array<{ rating: number; comment: string; reviewerName: string }>;
  images?: string[];
  thumbnail?: string;
}

export interface DummyJsonProductList {
  products: DummyJsonProduct[];
  total: number;
  skip: number;
  limit: number;
}

export interface DummyJsonCategory {
  slug: string;
  name: string;
  url: string;
}
