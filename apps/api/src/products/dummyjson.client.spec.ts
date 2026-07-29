import { ConfigService } from '@nestjs/config';
import { DummyJsonClient } from './dummyjson.client';

const PRODUCT_LIST = { products: [{ id: 1, title: 'A laptop' }], total: 1, skip: 0, limit: 1 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A body can only be read once, so every call needs its own Response. */
function alwaysRespond(body: unknown, status = 200) {
  return () => Promise.resolve(jsonResponse(body, status));
}

describe('DummyJsonClient', () => {
  let fetchMock: jest.SpyInstance;

  const buildClient = (overrides: Record<string, unknown> = {}) =>
    new DummyJsonClient(
      new ConfigService({
        DUMMYJSON_BASE_URL: 'https://catalog.test',
        DUMMYJSON_RETRY_DELAY_MS: 0,
        ...overrides,
      }),
    );

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('requests the full catalog with limit=0', async () => {
    fetchMock.mockImplementation(alwaysRespond(PRODUCT_LIST));

    await expect(buildClient().getAllProducts()).resolves.toEqual(PRODUCT_LIST);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://catalog.test/products?limit=0',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('url-encodes search terms and category slugs', async () => {
    fetchMock.mockImplementation(alwaysRespond(PRODUCT_LIST));
    const client = buildClient();

    await client.searchProducts('red lipstick');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://catalog.test/products/search?q=red+lipstick&limit=0',
    );

    await client.getProductsByCategory('mens shirts');
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://catalog.test/products/category/mens%20shirts?limit=0',
    );
  });

  it('caches repeated reads of the same resource', async () => {
    fetchMock.mockImplementation(alwaysRespond(PRODUCT_LIST));
    const client = buildClient();

    await client.getAllProducts();
    await client.getAllProducts();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    client.clearCache();
    await client.getAllProducts();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a dropped connection and then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(jsonResponse(PRODUCT_LIST));

    await expect(buildClient().getAllProducts()).resolves.toEqual(PRODUCT_LIST);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries throttling and server errors', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(PRODUCT_LIST));

    await expect(buildClient().getAllProducts()).resolves.toEqual(PRODUCT_LIST);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up with a 503 once retries are exhausted', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));

    await expect(buildClient().getAllProducts()).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('unreachable'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404, which is a real answer', async () => {
    fetchMock.mockImplementation(alwaysRespond({}, 404));

    await expect(buildClient().getProduct(9999)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid product ids without calling the API', async () => {
    await expect(buildClient().getProduct(-1)).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
