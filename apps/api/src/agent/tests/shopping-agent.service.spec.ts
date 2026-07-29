import type { ChatMessage, ProductListWidget } from '@shopping-copilot/shared';
import type { DummyJsonClient } from '../../products/dummyjson.client';
import { toProduct } from '../../products/product.mapper';
import { ProductsService } from '../../products/products.service';
import type { AgentEvent } from '../agent.types';
import { ShoppingAgentService } from '../shopping-agent.service';
import { FakeDummyJsonClient } from '../../../test/fakes/fake-dummyjson.client';
import { FakeMemoryService } from '../../../test/fakes/fake-memory.service';
import {
  ScriptedModel,
  type ScriptedResolver,
  type ScriptedTurn,
} from '../../../test/fakes/scripted-model';
import { PRODUCT_FIXTURES } from '../../../test/fixtures/products.fixture';

interface AgentOptions {
  /** What the title model replies, or a resolver that can fail. */
  title?: ScriptedTurn[] | ScriptedResolver;
  /** Memory service backing the agent; defaults to an empty fake store. */
  memory?: FakeMemoryService;
}

function buildAgent(script: ScriptedTurn[] | ScriptedResolver, options: AgentOptions = {}) {
  const catalog = new FakeDummyJsonClient();
  const products = new ProductsService(catalog as unknown as DummyJsonClient);
  const memory = options.memory ?? new FakeMemoryService();
  const model = new ScriptedModel(script, 'test-model');
  const titleModel = new ScriptedModel(options.title ?? [{ text: 'Shopping' }], 'test-nano');

  return {
    agent: new ShoppingAgentService(products, memory, model, titleModel, null, null, null),
    model,
    titleModel,
    catalog,
    memory,
  };
}

async function collect(events: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function resultOf(events: AgentEvent[]) {
  const result = events.find((event) => event.type === 'result');
  if (!result || result.type !== 'result') throw new Error('the agent produced no result event');
  return result;
}

/** A card group as it would have been persisted on a past assistant message. */
function shownWidget(heading: string, productIds: number[]): ProductListWidget {
  const products = productIds.map((id) => {
    const raw = PRODUCT_FIXTURES.find((fixture) => fixture.id === id);
    if (!raw) throw new Error(`no product fixture with id ${id}`);
    return toProduct(raw);
  });

  return {
    type: 'product_list',
    id: `widget-${heading}`,
    heading,
    products,
    total: products.length,
    filters: {},
  };
}

function historyWith(widgets: ProductListWidget[]): ChatMessage[] {
  const createdAt = new Date().toISOString();
  return [
    { id: 'u1', role: 'user', content: 'show me laptops', createdAt, widgets: [] },
    { id: 'a1', role: 'assistant', content: 'Here is what I found.', createdAt, widgets },
  ];
}

describe('ShoppingAgentService', () => {
  it('searches the catalog and returns a product widget plus a spoken answer', async () => {
    const { agent } = buildAgent([
      {
        toolCalls: [
          { name: 'search_products', args: { query: 'laptop', max_price: 1500, limit: 3 } },
        ],
      },
      { text: 'Here are three laptops that fit your budget.' },
    ]);

    const events = await collect(agent.run([], 'I need a laptop under $1500'));
    const result = resultOf(events);

    expect(result.content).toBe('Here are three laptops that fit your budget.');
    expect(result.widgets).toHaveLength(1);

    const widget = result.widgets[0] as ProductListWidget;
    expect(widget.type).toBe('product_list');
    expect(widget.products.length).toBeGreaterThan(0);
    expect(widget.products.every((product) => product.finalPrice <= 1500)).toBe(true);
    expect(widget.heading).toBe('Results for “laptop” · under $1500');

    // Every card carries what the UI renders.
    for (const product of widget.products) {
      expect(product).toMatchObject({
        id: expect.any(Number),
        title: expect.any(String),
        description: expect.any(String),
        finalPrice: expect.any(Number),
        thumbnail: expect.stringContaining('http'),
      });
    }
  });

  it('keeps the static prompt first and the volatile context last, for prompt caching', async () => {
    const { agent, model } = buildAgent([{ text: 'Hello!' }]);
    await collect(agent.run(historyWith([shownWidget('Laptops', [2])]), 'which is best?'));

    const { messages } = model.requests[0];
    const roles = messages.map((message) => message.role);

    expect(roles[0]).toBe('system');
    expect(messages[0].content).toContain('You are a shopping agent');
    // The category list does not vary between turns, so it belongs in the
    // cacheable prefix. The clock does vary, so it must not.
    expect(messages[0].content).toContain('beauty, laptops, smartphones');
    expect(messages[0].content).not.toContain('Current date and time');

    // The clock rides with the new turn, after the replayed history, so the
    // growing prefix stays byte-identical between turns.
    expect(roles.slice(-2)).toEqual(['assistant', 'user']);
    const turn = messages.at(-1)?.content ?? '';
    expect(turn).toContain('<context>');
    expect(turn).toContain('Current date and time');
    expect(turn.endsWith('which is best?')).toBe(true);
    // The replayed history carries none of it.
    expect(messages.at(-2)?.content).not.toContain('<context>');
  });

  it('sends a byte-identical prompt prefix on every turn of a conversation', async () => {
    const { agent, model } = buildAgent([{ text: 'Hello!' }, { text: 'Hello again!' }]);

    await collect(agent.run([], 'show me laptops'));
    await collect(agent.run(historyWith([shownWidget('Laptops', [2])]), 'which is best?'));

    // The prefix is what the provider cache keys on; if the instructions differ
    // by so much as a byte between turns, every turn pays full price.
    expect(model.requests[1].messages[0].content).toBe(model.requests[0].messages[0].content);
  });

  it('reuses the last known categories when the catalog goes down mid-conversation', async () => {
    const { agent, model, catalog } = buildAgent([{ text: 'Hello!' }, { text: 'Hello again!' }]);

    await collect(agent.run([], 'show me laptops'));
    jest.spyOn(catalog, 'getCategories').mockRejectedValueOnce(new Error('catalog unreachable'));
    await collect(agent.run([], 'and a mascara'));

    // Falling back to an empty list would rewrite the cached prefix for every
    // conversation at once, then rewrite it again when the catalog recovered.
    expect(model.requests[1].messages[0].content).toBe(model.requests[0].messages[0].content);
    expect(model.requests[1].messages[0].content).toContain('beauty, laptops, smartphones');
  });

  it('sends the conversation id as a prompt cache key', async () => {
    const { agent, model } = buildAgent([{ text: 'Hello!' }]);
    await collect(agent.run([], 'hi', { conversationId: 'conversation-7' }));

    expect(model.requests[0].providerOptions).toMatchObject({
      openai: { promptCacheKey: 'conversation-7' },
    });
  });

  it('normalises the shopper message before it reaches the model', async () => {
    const { agent, model } = buildAgent([{ text: 'Hello!' }]);
    await collect(agent.run([], '  show me \u200bｌａｐｔｏｐｓ\u0007  '));

    expect(model.requests[0].messages.at(-1)?.content).toMatch(/show me laptops$/);
  });

  it('wraps catalog results in a data block the prompt treats as untrusted', async () => {
    const { agent, model } = buildAgent([
      { toolCalls: [{ name: 'search_products', args: { query: 'mascara' } }] },
      { text: 'The Essence mascara is a great pick.' },
    ]);

    await collect(agent.run([], 'show me a mascara'));

    const toolMessage = model.requests[1].messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('<product_data trust="untrusted">');
    expect(toolMessage?.content).toContain('</product_data>');
  });

  it('exposes the catalog and memory tools to the model', async () => {
    const { agent, model } = buildAgent([{ text: 'Hello!' }]);
    await collect(agent.run([], 'hi'));

    expect(model.requests[0].toolNames.sort()).toEqual([
      'forget_fact',
      'get_product_details',
      'list_categories',
      'remember_fact',
      'search_products',
    ]);
  });

  it('streams text deltas and a tool checklist before the final result', async () => {
    const { agent } = buildAgent([
      { toolCalls: [{ name: 'search_products', args: { query: 'mascara' } }] },
      { text: 'The Essence mascara is a great pick.' },
    ]);

    const events = await collect(agent.run([], 'show me a mascara'));

    // The call is announced when it starts and the same line is then resolved,
    // so the shopper watches the search rather than waiting on a blank screen.
    expect(
      events.filter((event) => event.type === 'tool_activity').map((event) => event.activity),
    ).toEqual([
      { id: expect.any(String), label: 'Searching the catalog for “mascara”', state: 'running' },
      { id: expect.any(String), label: 'Found 1 product for “mascara”', state: 'done' },
    ]);
    const [started, finished] = events.filter((event) => event.type === 'tool_activity');
    expect(started.activity.id).toBe(finished.activity.id);
    expect(events.some((event) => event.type === 'widget')).toBe(true);

    const streamed = events
      .filter(
        (event): event is Extract<AgentEvent, { type: 'text_delta' }> => event.type === 'text_delta',
      )
      .map((event) => event.delta)
      .join('');
    expect(streamed.trim()).toBe('The Essence mascara is a great pick.');
  });

  it('records a tool trace for each catalog call', async () => {
    const { agent } = buildAgent([
      { toolCalls: [{ name: 'search_products', args: { category: 'beauty' } }] },
      { text: 'Found some beauty products.' },
    ]);

    const result = resultOf(await collect(agent.run([], 'what beauty products do you have?')));

    expect(result.toolTrace).toHaveLength(1);
    expect(result.toolTrace[0]).toMatchObject({
      name: 'search_products',
      args: { category: 'beauty' },
      resultCount: 1,
      // Persisted so a reloaded conversation shows the same checklist.
      label: 'Found 1 product in Beauty',
    });
    expect(result.toolTrace[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('runs several tool calls across turns, e.g. broadening a search that was too narrow', async () => {
    const { agent } = buildAgent([
      { toolCalls: [{ name: 'search_products', args: { query: 'laptop', max_price: 100 } }] },
      { toolCalls: [{ name: 'search_products', args: { query: 'laptop' } }] },
      { text: 'Nothing under $100, but here are the cheapest laptops.' },
    ]);

    const result = resultOf(await collect(agent.run([], 'a laptop under $100')));

    expect(result.toolTrace).toHaveLength(2);
    expect(result.widgets).toHaveLength(2);
  });

  it('runs one search per item when a turn asks for several things at once', async () => {
    const { agent } = buildAgent([
      {
        toolCalls: [
          { name: 'search_products', args: { query: 'laptop', max_price: 1500 } },
          { name: 'search_products', args: { query: 'mascara', max_price: 20 } },
        ],
      },
      { text: 'The Yoga 920 fits your laptop budget, and the Essence mascara is $10.' },
    ]);

    const events = await collect(agent.run([], 'a laptop under $1500 and a mascara under $20'));
    const result = resultOf(events);

    // One card group per item, each answering its own budget.
    expect(result.widgets).toHaveLength(2);
    const [laptops, mascara] = result.widgets as ProductListWidget[];
    expect(laptops.heading).toBe('Results for “laptop” · under $1500');
    expect(laptops.products.every((product) => product.finalPrice <= 1500)).toBe(true);
    expect(mascara.heading).toBe('Results for “mascara” · under $20');
    expect(mascara.products.every((product) => product.finalPrice <= 20)).toBe(true);

    expect(result.toolTrace.map((entry) => entry.args.query)).toEqual(['laptop', 'mascara']);
    expect(events.filter((event) => event.type === 'tool_activity')).toHaveLength(4);
  });

  it('handles product detail lookups by id', async () => {
    const { agent } = buildAgent([
      { toolCalls: [{ name: 'get_product_details', args: { product_id: 4 } }] },
      { text: 'The iPhone 15 Pro ships quickly and has a 4.9 rating.' },
    ]);

    const result = resultOf(await collect(agent.run([], 'tell me more about the iPhone')));
    const widget = result.widgets[0] as ProductListWidget;

    expect(widget.products).toHaveLength(1);
    expect(widget.products[0].id).toBe(4);
    expect(widget.heading).toBe('Apple iPhone 15 Pro');
  });

  it('tells the model about a bad product id instead of failing the turn', async () => {
    const { agent } = buildAgent([
      { toolCalls: [{ name: 'get_product_details', args: { product_id: 999 } }] },
      { text: 'I could not find that product.' },
    ]);

    const result = resultOf(await collect(agent.run([], 'details for product 999')));

    expect(result.widgets).toHaveLength(0);
    expect(result.toolTrace[0].error).toContain('Unknown product id');
    expect(result.content).toBe('I could not find that product.');
  });

  it('recovers from invalid tool arguments', async () => {
    const { agent, model } = buildAgent([
      { toolCalls: [{ name: 'search_products', args: { min_rating: 42 } }] },
      { toolCalls: [{ name: 'search_products', args: { min_rating: 4 } }] },
      { text: 'Here are the top rated products.' },
    ]);

    const result = resultOf(await collect(agent.run([], 'only show great products')));

    // A rating of 42 fails the schema, so the call never reaches the catalog.
    expect(result.toolTrace[0].error).toBeDefined();
    expect(result.toolTrace[0].resultCount).toBe(0);
    expect(result.widgets).toHaveLength(1);
    // The rejection was reported back to the model so it could retry.
    const replayed = JSON.stringify(model.requests[1].messages);
    expect(replayed).toMatch(/min_rating/i);
  });

  it('replays previously shown products so follow-up references resolve', async () => {
    const history = historyWith([shownWidget('Laptops', [2])]);

    const { agent, model } = buildAgent([{ text: 'That one is the Lenovo Yoga 920.' }]);
    await collect(agent.run(history, 'what was the second one?'));

    const replayed = JSON.stringify(model.requests[0].messages);
    expect(replayed).toContain('<shown_products trust=\\"untrusted\\">');
    expect(replayed).toContain('Lenovo Yoga 920 Laptop');
    expect(replayed).toContain('id=2');
  });

  it('replays each card group separately so "the second one" is unambiguous', async () => {
    const history = historyWith([
      shownWidget('Results for “laptop”', [1, 2]),
      shownWidget('Results for “mascara”', [5]),
    ]);

    const { agent, model } = buildAgent([{ text: 'That is the Lenovo Yoga 920.' }]);
    await collect(agent.run(history, 'tell me about the second laptop'));

    const replayed = model.requests[0].messages.map((message) => message.content).join('\n');

    // Numbering restarts per group, matching the two lists the shopper saw.
    expect(replayed).toContain('Group “Results for “laptop””:\n1. id=1');
    expect(replayed).toContain('2. id=2');
    expect(replayed).toContain('Group “Results for “mascara””:\n1. id=5');
  });

  it('stops asking for tools after the step budget and still answers', async () => {
    // More scripted tool-call turns than MAX_STEPS (8) so the loop actually hits
    // the budget instead of running out of scripted turns first.
    const alwaysSearching: ScriptedTurn[] = Array.from({ length: 10 }, () => ({
      toolCalls: [{ name: 'search_products', args: { query: 'laptop' } }],
    }));

    const { agent, model } = buildAgent(alwaysSearching);
    const result = resultOf(await collect(agent.run([], 'laptops please')));

    expect(model.requests).toHaveLength(8);
    expect(result.content).toContain('Here is what I found');
  });

  it('falls back to a friendly message when the model returns nothing', async () => {
    const { agent } = buildAgent([{ text: '' }]);
    const result = resultOf(await collect(agent.run([], 'hello')));

    expect(result.content).toContain('could not find anything');
    expect(result.widgets).toHaveLength(0);
  });

  it('reports a tool the catalog does not offer instead of failing the turn', async () => {
    const { agent } = buildAgent([
      { toolCalls: [{ name: 'buy_product', args: { id: 1 } }] },
      { text: 'I can only help you browse.' },
    ]);

    const result = resultOf(await collect(agent.run([], 'buy it for me')));

    expect(result.toolTrace[0]).toMatchObject({ name: 'buy_product', resultCount: 0 });
    expect(result.toolTrace[0].error).toBeDefined();
    expect(result.content).toBe('I can only help you browse.');
  });

  describe('long-term memory', () => {
    it('injects stored facts as a <memory> block ahead of the shopper message', async () => {
      const memory = new FakeMemoryService([
        { key: 'gender', value: 'male', updatedAt: '2026-07-29T12:00:00.000Z' },
      ]);
      const { agent, model } = buildAgent([{ text: 'Got it.' }], { memory });

      await collect(agent.run([], 'show me shirts'));

      const turn = model.requests[0].messages.at(-1)?.content ?? '';
      expect(turn).toContain('<memory>');
      expect(turn).toContain('- gender: male');
      // The memory block rides with the per-turn context, ahead of the message.
      expect(turn.indexOf('<memory>')).toBeLessThan(turn.indexOf('show me shirts'));
    });

    it('omits the <memory> block when nothing is stored', async () => {
      const { agent, model } = buildAgent([{ text: 'Hello!' }]);
      await collect(agent.run([], 'hi'));
      expect(model.requests[0].messages.at(-1)?.content).not.toContain('<memory>');
    });

    it('persists a fact when the model calls remember_fact', async () => {
      const { agent, memory } = buildAgent([
        { toolCalls: [{ name: 'remember_fact', args: { key: 'gender', value: 'male' } }] },
        { text: 'Got it — I will remember you are looking for men\'s items.' },
      ]);

      const result = resultOf(await collect(agent.run([], "I'm a male, remember that")));

      expect(memory.rememberCalls).toEqual([{ key: 'gender', value: 'male' }]);
      expect(await memory.list()).toContainEqual(
        expect.objectContaining({ key: 'gender', value: 'male' }),
      );
      expect(result.toolTrace[0]).toMatchObject({
        name: 'remember_fact',
        resultCount: 1,
        label: 'Remembered gender',
      });
    });

    it('drops a fact when the model calls forget_fact', async () => {
      const memory = new FakeMemoryService([
        { key: 'gender', value: 'male', updatedAt: '2026-07-29T12:00:00.000Z' },
      ]);
      const { agent } = buildAgent(
        [
          { toolCalls: [{ name: 'forget_fact', args: { key: 'gender' } }] },
          { text: 'Done — I have forgotten that.' },
        ],
        { memory },
      );

      const result = resultOf(await collect(agent.run([], 'forget that I am male')));

      expect(memory.forgetCalls).toEqual(['gender']);
      expect(await memory.list()).toEqual([]);
      expect(result.toolTrace[0]).toMatchObject({
        name: 'forget_fact',
        resultCount: 1,
        label: 'Forgot gender',
      });
    });
  });

  describe('generateTitle', () => {
    it('uses the cheap model output as the conversation title', async () => {
      const { agent, titleModel } = buildAgent([], {
        title: [{ text: 'Work Laptop Under $1500' }],
      });

      await expect(agent.generateTitle('I need a laptop for work under $1500')).resolves.toBe(
        'Work Laptop Under $1500',
      );
      expect(titleModel.requests[0].modelId).toBe('test-nano');
    });

    it('falls back to the first few words when the model call fails', async () => {
      const { agent } = buildAgent([], {
        title: () => {
          throw new Error('rate limited');
        },
      });

      await expect(
        agent.generateTitle('I would like a very nice pair of running shoes please'),
      ).resolves.toBe('I would like a very nice');
    });
  });
});
