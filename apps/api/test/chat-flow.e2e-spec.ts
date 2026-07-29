import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type {
  ChatStreamEvent,
  Conversation,
  ConversationSummary,
  ProductListWidget,
  SendMessageResponse,
} from '@shopping-copilot/shared';
import { AppModule } from '../src/app.module';
import { AGENT_MODEL, GUARD_MODEL, MASTRA_PLATFORM_ACCESS_TOKEN, MASTRA_PROJECT_ID, TITLE_MODEL } from '../src/agent/model.tokens';
import { DummyJsonClient } from '../src/products/dummyjson.client';
import { FakeDummyJsonClient } from './fakes/fake-dummyjson.client';
import { ScriptedModel } from './fakes/scripted-model';

/**
 * End-to-end coverage of the core flow over real HTTP: shopper message →
 * catalog retrieval → product widget in the response → persisted history.
 *
 * The model and the catalog are replaced with deterministic fakes; everything
 * else (controllers, validation, agent loop, SSE framing, JSON file store) is
 * the production wiring.
 */
describe('Chat flow (e2e)', () => {
  let app: INestApplication;
  let llm: ScriptedModel;
  let titleLlm: ScriptedModel;
  let dataDir: string;

  const searchTurn = (args: Record<string, unknown>, text: string) => [
    { toolCalls: [{ name: 'search_products', args }] },
    { text },
  ];

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'copilot-e2e-'));
    process.env.DATA_DIR = dataDir;

    llm = new ScriptedModel([]);
    titleLlm = new ScriptedModel([{ text: 'Shopping' }]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AGENT_MODEL)
      .useValue(llm)
      .overrideProvider(TITLE_MODEL)
      .useValue(titleLlm)
      // No injection classifier: it would need a real model call per turn.
      .overrideProvider(GUARD_MODEL)
      .useValue(null)
      // No observability in e2e: no platform credentials, and no network calls.
      .overrideProvider(MASTRA_PLATFORM_ACCESS_TOKEN)
      .useValue(null)
      .overrideProvider(MASTRA_PROJECT_ID)
      .useValue(null)
      .overrideProvider(DummyJsonClient)
      .useValue(new FakeDummyJsonClient())
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  });

  const createConversation = async (): Promise<Conversation> => {
    const response = await request(app.getHttpServer())
      .post('/api/conversations')
      .send({})
      .expect(201);
    return response.body as Conversation;
  };

  describe('sending a message', () => {
    it('answers with a product widget and persists the whole turn', async () => {
      llm.reset(
        searchTurn(
          { query: 'laptop', max_price: 1500, limit: 3 },
          'These laptops all fit under $1500.',
        ),
      );
      titleLlm.reset([{ text: 'Laptops Under $1500' }]);

      const conversation = await createConversation();
      const response = await request(app.getHttpServer())
        .post(`/api/conversations/${conversation.id}/messages`)
        .send({ content: 'I need a laptop under $1500' })
        .expect(201);

      const body = response.body as SendMessageResponse;
      expect(body.userMessage.content).toBe('I need a laptop under $1500');
      expect(body.assistantMessage.content).toBe('These laptops all fit under $1500.');
      expect(body.title).toBe('Laptops Under $1500');

      const widget = body.assistantMessage.widgets[0] as ProductListWidget;
      expect(widget.type).toBe('product_list');
      expect(widget.products.length).toBeGreaterThan(0);
      expect(widget.products.every((product) => product.finalPrice <= 1500)).toBe(true);
      expect(widget.products[0]).toMatchObject({
        title: expect.any(String),
        description: expect.any(String),
        finalPrice: expect.any(Number),
        thumbnail: expect.any(String),
      });

      // Reloading the conversation returns the same messages and widgets,
      // which is what a browser refresh does.
      const reloaded = await request(app.getHttpServer())
        .get(`/api/conversations/${conversation.id}`)
        .expect(200);
      const stored = reloaded.body as Conversation;

      expect(stored.title).toBe('Laptops Under $1500');
      expect(stored.messages).toHaveLength(2);
      expect((stored.messages[1].widgets[0] as ProductListWidget).products).toEqual(
        widget.products,
      );
      expect(stored.messages[1].toolTrace?.[0].name).toBe('search_products');
    });

    it('carries earlier turns into the next request so follow-ups have context', async () => {
      llm.reset(searchTurn({ category: 'laptops' }, 'Here are our laptops.'));
      const conversation = await createConversation();

      await request(app.getHttpServer())
        .post(`/api/conversations/${conversation.id}/messages`)
        .send({ content: 'show me laptops' })
        .expect(201);

      llm.reset([{ text: 'The MacBook Pro is the highest rated one.' }]);
      await request(app.getHttpServer())
        .post(`/api/conversations/${conversation.id}/messages`)
        .send({ content: 'which is best?' })
        .expect(201);

      const replayed = JSON.stringify(llm.requests[0].messages);
      expect(replayed).toContain('show me laptops');
      expect(replayed).toContain('<shown_products trust=\\"untrusted\\">');

      const stored = await request(app.getHttpServer())
        .get(`/api/conversations/${conversation.id}`)
        .expect(200);
      expect((stored.body as Conversation).messages).toHaveLength(4);
    });

    it('rejects an empty message', async () => {
      const conversation = await createConversation();
      await request(app.getHttpServer())
        .post(`/api/conversations/${conversation.id}/messages`)
        .send({ content: '   ' })
        .expect(201); // whitespace passes validation but is trimmed by the agent

      await request(app.getHttpServer())
        .post(`/api/conversations/${conversation.id}/messages`)
        .send({ content: '' })
        .expect(400);
    });

    it('returns 404 for an unknown conversation', async () => {
      await request(app.getHttpServer())
        .post('/api/conversations/does-not-exist/messages')
        .send({ content: 'hello' })
        .expect(404);
    });
  });

  describe('streaming a message', () => {
    it('emits the shopper message, tool activity, widget, text deltas and the final message', async () => {
      llm.reset(searchTurn({ query: 'mascara' }, 'The Essence mascara is a great pick.'));
      const conversation = await createConversation();

      const response = await request(app.getHttpServer())
        .post(`/api/conversations/${conversation.id}/messages/stream`)
        .send({ content: 'I want a mascara' })
        .expect(200)
        .expect('Content-Type', /text\/event-stream/);

      const events = parseSse(response.text);
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          'user_message',
          'tool_activity',
          'widget',
          'text_delta',
          'message',
          'title',
          'done',
        ]),
      );
      expect(events[0].type).toBe('user_message');
      expect(events[events.length - 1].type).toBe('done');

      // The search is announced before it resolves, and both halves of the
      // checklist line carry the same id.
      const activities = events
        .filter((event) => event.type === 'tool_activity')
        .map((event) => (event.type === 'tool_activity' ? event.activity : null));
      expect(activities.map((activity) => activity?.state)).toEqual(['running', 'done']);
      expect(activities[0]?.id).toBe(activities[1]?.id);
      expect(activities[1]?.label).toContain('Found');

      const widgetEvent = events.find((event) => event.type === 'widget');
      expect(widgetEvent && widgetEvent.type === 'widget' && widgetEvent.widget.products[0].id).toBe(
        5,
      );

      const streamedText = events
        .filter((event) => event.type === 'text_delta')
        .map((event) => (event.type === 'text_delta' ? event.delta : ''))
        .join('')
        .trim();
      expect(streamedText).toBe('The Essence mascara is a great pick.');

      const finalEvent = events.find((event) => event.type === 'message');
      expect(finalEvent?.type === 'message' && finalEvent.message.content).toBe(streamedText);
    });

    it('reports a model failure as an error event and still persists a reply', async () => {
      llm.reset(() => {
        throw new Error('model exploded');
      });
      const conversation = await createConversation();

      const response = await request(app.getHttpServer())
        .post(`/api/conversations/${conversation.id}/messages/stream`)
        .send({ content: 'find me shoes' })
        .expect(200);

      const events = parseSse(response.text);
      const errorEvent = events.find((event) => event.type === 'error');
      expect(errorEvent?.type === 'error' && errorEvent.message).toContain('model exploded');

      const stored = await request(app.getHttpServer())
        .get(`/api/conversations/${conversation.id}`)
        .expect(200);
      const messages = (stored.body as Conversation).messages;
      expect(messages).toHaveLength(2);
      expect(messages[1].content).toContain('could not complete that request');
    });
  });

  describe('managing conversations', () => {
    it('lists conversations with the most recent first, then renames and deletes one', async () => {
      llm.reset(searchTurn({ query: 'iphone' }, 'The iPhone 15 Pro is our flagship.'));
      const conversation = await createConversation();
      await request(app.getHttpServer())
        .post(`/api/conversations/${conversation.id}/messages`)
        .send({ content: 'do you have an iPhone?' })
        .expect(201);

      const list = await request(app.getHttpServer()).get('/api/conversations').expect(200);
      const summaries = list.body as ConversationSummary[];
      expect(summaries[0].id).toBe(conversation.id);
      expect(summaries[0].messageCount).toBe(2);
      expect(summaries[0].lastMessagePreview).toContain('iPhone 15 Pro');

      await request(app.getHttpServer())
        .patch(`/api/conversations/${conversation.id}`)
        .send({ title: 'Phone hunting' })
        .expect(200);
      const renamed = await request(app.getHttpServer())
        .get(`/api/conversations/${conversation.id}`)
        .expect(200);
      expect((renamed.body as Conversation).title).toBe('Phone hunting');

      await request(app.getHttpServer())
        .delete(`/api/conversations/${conversation.id}`)
        .expect(204);
      await request(app.getHttpServer())
        .get(`/api/conversations/${conversation.id}`)
        .expect(404);
    });
  });

  describe('product endpoints', () => {
    it('applies filters and sorting', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/products')
        .query({ query: 'laptop', maxPrice: 1500, sortBy: 'price', limit: 5 })
        .expect(200);

      const prices = response.body.products.map((product: { finalPrice: number }) => product.finalPrice);
      expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
      expect(Math.max(...prices)).toBeLessThanOrEqual(1500);
    });

    it('rejects out-of-range parameters', async () => {
      await request(app.getHttpServer())
        .get('/api/products')
        .query({ minRating: 9 })
        .expect(400);
    });

    it('returns categories and a single product', async () => {
      await request(app.getHttpServer())
        .get('/api/products/categories')
        .expect(200)
        .expect(({ body }) => expect(body).toEqual(expect.arrayContaining([{ slug: 'laptops', name: 'Laptops' }])));

      await request(app.getHttpServer())
        .get('/api/products/4')
        .expect(200)
        .expect(({ body }) => expect(body.title).toContain('iPhone'));

      await request(app.getHttpServer()).get('/api/products/999').expect(404);
    });
  });
});

function parseSse(raw: string): ChatStreamEvent[] {
  return raw
    .split('\n\n')
    .map((frame) =>
      frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n'),
    )
    .filter(Boolean)
    .map((payload) => JSON.parse(payload) as ChatStreamEvent);
}
