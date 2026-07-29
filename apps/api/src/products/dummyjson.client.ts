import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DummyJsonCategory, DummyJsonProduct, DummyJsonProductList } from './dummyjson.types';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Thin HTTP client for the DummyJSON products API.
 *
 * The catalog is small (~200 products) and immutable, so full-catalog and
 * category responses are cached in memory. That keeps the agent's tool calls
 * fast enough to run several of them inside a single turn.
 */
@Injectable()
export class DummyJsonClient {
  private readonly logger = new Logger(DummyJsonClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('DUMMYJSON_BASE_URL') ?? 'https://dummyjson.com').replace(
      /\/$/,
      '',
    );
    this.timeoutMs = Number(config.get('DUMMYJSON_TIMEOUT_MS') ?? 10_000);
    this.ttlMs = Number(config.get('DUMMYJSON_CACHE_TTL_MS') ?? 5 * 60_000);
    this.maxRetries = Number(config.get('DUMMYJSON_MAX_RETRIES') ?? 2);
    this.retryDelayMs = Number(config.get('DUMMYJSON_RETRY_DELAY_MS') ?? 250);
  }

  /** Every product in the catalog (`limit=0` returns the full list). */
  getAllProducts(): Promise<DummyJsonProductList> {
    return this.cached('all', () => this.get<DummyJsonProductList>('/products?limit=0'));
  }

  searchProducts(query: string, limit = 0): Promise<DummyJsonProductList> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.cached(`search:${query}:${limit}`, () =>
      this.get<DummyJsonProductList>(`/products/search?${params.toString()}`),
    );
  }

  getProductsByCategory(slug: string, limit = 0): Promise<DummyJsonProductList> {
    const params = new URLSearchParams({ limit: String(limit) });
    return this.cached(`category:${slug}:${limit}`, () =>
      this.get<DummyJsonProductList>(
        `/products/category/${encodeURIComponent(slug)}?${params.toString()}`,
      ),
    );
  }

  getCategories(): Promise<DummyJsonCategory[]> {
    return this.cached('categories', () => this.get<DummyJsonCategory[]>('/products/categories'));
  }

  async getProduct(id: number): Promise<DummyJsonProduct> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new NotFoundException(`Unknown product id: ${id}`);
    }
    return this.cached(`product:${id}`, () => this.get<DummyJsonProduct>(`/products/${id}`));
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value as T;
    }
    const value = await load();
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  /**
   * Transient failures (timeouts, dropped connections, 5xx, throttling) are
   * retried with a short backoff: one flaky request should not cost the shopper
   * their answer. Deliberate outcomes such as 404 are returned immediately.
   */
  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastReason = 'unknown error';

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
        this.logger.warn(`Retrying ${url} (attempt ${attempt + 1}): ${lastReason}`);
      }

      try {
        const response = await fetch(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.status === 404) {
          throw new NotFoundException(`Product catalog returned 404 for ${path}`);
        }
        if (response.status === 429 || response.status >= 500) {
          lastReason = `status ${response.status}`;
          continue;
        }
        if (!response.ok) {
          throw new HttpException(`Product catalog returned ${response.status} for ${path}`, 502);
        }

        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof HttpException) throw error;
        lastReason = error instanceof Error ? error.message : String(error);
      }
    }

    this.logger.error(`Request to ${url} failed after ${this.maxRetries + 1} attempts: ${lastReason}`);
    throw new HttpException(`Product catalog is unreachable (${lastReason})`, 503);
  }
}
