import { ShoppingAgentService } from '../src/agent/shopping-agent.service';
import { GET_PRODUCT_DETAILS, SEARCH_PRODUCTS } from '../src/agent/tools';
import type { DummyJsonClient } from '../src/products/dummyjson.client';
import { ProductsService } from '../src/products/products.service';
import {
  check,
  completeWhen,
  ConversationEvaluatorService,
  ConversationSimulatorService,
  ShoppingAgentUnderTest,
  UserSimulatorFactory,
  type Persona,
  type Rubric,
  type Scenario,
} from '../src/simulation';
import { FakeDummyJsonClient } from './fakes/fake-dummyjson.client';
import { FakeMemoryService } from './fakes/fake-memory.service';
import {
  RoutedLlmClient,
  routedAgentModel,
  type RoutedHandler,
  type RoutedReply,
} from './fakes/routed-llm.client';
import { ScriptedModel } from './fakes/scripted-model';

function createHarness(handler: RoutedHandler) {
  const llm = new RoutedLlmClient(handler);
  const products = new ProductsService(new FakeDummyJsonClient() as unknown as DummyJsonClient);
  const agent = new ShoppingAgentService(
    products,
    new FakeMemoryService(),
    routedAgentModel(handler),
    new ScriptedModel([{ text: 'Simulated conversation' }]),
    null,
    null,
    null,
  );

  const harness = new ConversationSimulatorService(
    new UserSimulatorFactory(llm),
    new ShoppingAgentUnderTest(agent),
    new ConversationEvaluatorService(llm),
  );

  return { harness, llm };
}

const ANSWER = 'Here are a couple of laptops that fit.';

const searchThenAnswer: RoutedHandler = ({ awaitingAnswer }) =>
  awaitingAnswer
    ? { text: ANSWER }
    : { toolCalls: [{ name: SEARCH_PRODUCTS, args: { category: 'laptops' } }] };

function scriptedPersona(script: string[]): Persona {
  return {
    id: 'scripted-shopper',
    name: 'Scripted shopper',
    profile: 'A shopper following a fixed path.',
    goal: 'Buy a laptop.',
    script,
  };
}

const SEARCH_RUBRIC: Rubric = {
  criteria: [
    {
      id: 'searched-catalog',
      description: 'The assistant searched the catalog.',
      check: check.calledTool(SEARCH_PRODUCTS),
    },
  ],
};

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'laptops',
    title: 'Laptop browsing',
    maxTurns: 5,
    persona: scriptedPersona(['show me your laptops', 'great, thanks']),
    rubric: SEARCH_RUBRIC,
    ...overrides,
  };
}

describe('ConversationSimulatorService', () => {
  it('drives a scripted shopper through the whole conversation', async () => {
    const { harness, llm } = createHarness(searchThenAnswer);

    const result = await harness.runScenario(scenario());

    expect(result.conversation.turns).toHaveLength(2);
    expect(result.conversation.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(result.conversation.messages[0].content).toBe('show me your laptops');
    expect(result.conversation.messages[1].content).toBe(ANSWER);
    expect(result.stopReason).toBe('user_satisfied');
    expect(result.evaluation.passed).toBe(true);

    expect(llm.requestsFrom('shopper')).toHaveLength(0);
    expect(llm.requestsFrom('judge')).toHaveLength(0);
  });

  it('records the tool trace and latency of every turn', async () => {
    const { harness } = createHarness(searchThenAnswer);

    const result = await harness.runScenario(scenario());

    for (const turn of result.conversation.turns) {
      expect(turn.toolTrace.map((call) => call.name)).toEqual([SEARCH_PRODUCTS]);
      expect(turn.activities.length).toBeGreaterThan(0);
      expect(turn.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('checks whether a two-item request was searched item by item', async () => {
    const splitRubric: Rubric = {
      criteria: [
        {
          id: 'separate-searches',
          description: 'The laptop and the sunglasses were searched separately.',
          check: check.searchedSeparatelyFor(SEARCH_PRODUCTS, ['laptop', 'sunglass']),
        },
      ],
    };
    const twoItems = scenario({
      persona: scriptedPersona(['a laptop and sunglasses']),
      rubric: splitRubric,
      maxTurns: 1,
    });

    const split = await createHarness(({ awaitingAnswer }) =>
      awaitingAnswer
        ? { text: ANSWER }
        : {
            toolCalls: [
              { name: SEARCH_PRODUCTS, args: { query: 'laptop' } },
              { name: SEARCH_PRODUCTS, args: { query: 'sunglasses' } },
            ],
          },
    ).harness.runScenario(twoItems);

    const fused = await createHarness(({ awaitingAnswer }) =>
      awaitingAnswer
        ? { text: ANSWER }
        : { toolCalls: [{ name: SEARCH_PRODUCTS, args: { query: 'laptop sunglasses' } }] },
    ).harness.runScenario(twoItems);

    expect(split.evaluation.criteria[0].passed).toBe(true);
    expect(fused.evaluation.criteria[0].passed).toBe(false);
    expect(fused.evaluation.criteria[0].reasoning).toContain('covered several items');
  });

  it('stops as soon as the scenario reports itself complete', async () => {
    const { harness } = createHarness(searchThenAnswer);

    const result = await harness.runScenario(
      scenario({
        persona: scriptedPersona(['show me your laptops', 'and cheaper?', 'anything else?', 'ok']),
        isComplete: completeWhen.productsShown(1),
      }),
    );

    expect(result.stopReason).toBe('scenario_complete');
    expect(result.conversation.turns).toHaveLength(1);
  });

  it('respects the turn budget', async () => {
    const { harness } = createHarness(() => ({ text: ANSWER }));

    const result = await harness.runScenario(
      scenario({
        persona: scriptedPersona(['one', 'two', 'three', 'four', 'five']),
        maxTurns: 2,
      }),
    );

    expect(result.stopReason).toBe('max_turns');
    expect(result.conversation.turns).toHaveLength(2);
  });

  it('resumes from seeded history without re-running those turns', async () => {
    const { harness } = createHarness(searchThenAnswer);
    const seeded = await harness.runScenario(scenario());

    const result = await harness.runScenario(
      scenario({
        persona: scriptedPersona(['and something cheaper?']),
        seed: [...seeded.conversation.messages],
      }),
    );

    expect(result.conversation.turns).toHaveLength(1);
    expect(result.conversation.messages).toHaveLength(6);
    expect(result.conversation.messages[0].content).toBe('show me your laptops');
  });

  describe('the LLM-driven shopper', () => {
    const shopper: Persona = {
      id: 'dana',
      name: 'Dana',
      profile: 'A pragmatic shopper.',
      goal: 'Buy a laptop under $1000.',
      hiddenConstraints: ['You will not spend more than $1000.'],
    };

    const talkativeShopper: RoutedHandler = (context) => {
      if (context.participant !== 'shopper') return searchThenAnswer(context);
      return context.turn === 0
        ? { text: JSON.stringify({ message: 'i need a laptop', done: false }) }
        : { text: JSON.stringify({ message: 'perfect, ill take that one', done: true }) };
    };

    it('ends the conversation when the shopper says it is satisfied', async () => {
      const { harness } = createHarness(talkativeShopper);

      const result = await harness.runScenario(scenario({ persona: shopper }));

      expect(result.stopReason).toBe('user_satisfied');
      expect(result.conversation.turns).toHaveLength(2);
      expect(result.conversation.messages[0].content).toBe('i need a laptop');
    });

    it('sees the conversation from the shopper side, with roles inverted', async () => {
      const { harness, llm } = createHarness(talkativeShopper);

      await harness.runScenario(scenario({ persona: shopper }));

      const [system, own, agent] = llm.requestsFrom('shopper')[1].messages;

      expect(system.role).toBe('system');
      expect(own).toMatchObject({ role: 'assistant', content: 'i need a laptop' });
      expect(agent.role).toBe('user');
      expect(String(agent.content)).toContain(ANSWER);
    });

    it('describes the product cards without leaking catalog ids', async () => {
      const { harness, llm } = createHarness(talkativeShopper);

      await harness.runScenario(scenario({ persona: shopper }));

      const cards = String(llm.requestsFrom('shopper')[1].messages[2].content);
      expect(cards).toContain('1. "Apple MacBook Pro 14 Inch Space Grey"');
      expect(cards).not.toMatch(/id=/);
    });

    it('honours a pinned opener instead of asking the model', async () => {
      const { harness, llm } = createHarness(talkativeShopper);

      const result = await harness.runScenario(
        scenario({
          persona: { ...shopper, opener: 'hey, i need a new laptop' },
          maxTurns: 1,
        }),
      );

      expect(result.conversation.messages[0].content).toBe('hey, i need a new laptop');
      expect(llm.requestsFrom('shopper')).toHaveLength(0);
    });

    it('falls back to the raw reply when the shopper does not return JSON', async () => {
      const { harness } = createHarness((context) =>
        context.participant === 'shopper'
          ? { text: 'do you have anything cheaper' }
          : searchThenAnswer(context),
      );

      const result = await harness.runScenario(scenario({ persona: shopper, maxTurns: 1 }));

      expect(result.conversation.messages[0].content).toBe('do you have anything cheaper');
    });

    it('stops with a simulator error when the shopper produces nothing usable', async () => {
      const { harness } = createHarness((context) =>
        context.participant === 'shopper' ? { text: '' } : searchThenAnswer(context),
      );

      const result = await harness.runScenario(scenario({ persona: shopper }));

      expect(result.stopReason).toBe('simulator_error');
      expect(result.conversation.turns).toHaveLength(0);
      expect(result.error).toContain('no usable message');
    });
  });

  it('captures an agent failure and stops the run', async () => {
    const { harness } = createHarness(({ participant }) => {
      if (participant === 'agent') throw new Error('upstream 500');
      return { text: '{}' };
    });

    const result = await harness.runScenario(
      scenario({
        rubric: {
          criteria: [
            { id: 'no-errors', description: 'No errors occurred.', check: check.noErrors() },
          ],
        },
      }),
    );

    expect(result.stopReason).toBe('agent_error');
    expect(result.error).toContain('upstream 500');
    expect(result.conversation.turns[0].error).toContain('upstream 500');
    expect(result.evaluation.criteria[0].passed).toBe(false);
    expect(result.evaluation.passed).toBe(false);
  });

  it('aggregates repeated runs so flakiness is visible', async () => {
    const { harness } = createHarness(searchThenAnswer);

    const report = await harness.run([scenario()], { repetitions: 3, concurrency: 2 });

    expect(report.total).toBe(3);
    expect(report.passed).toBe(3);
    expect(report.byScenario).toEqual([
      { scenarioId: 'laptops', title: 'Laptop browsing', runs: 3, passed: 3 },
    ]);
    expect(report.results.map((result) => result.repetition)).toEqual([1, 2, 3]);
  });

  it('reports progress events as a suite runs', async () => {
    const { harness } = createHarness(searchThenAnswer);
    const seen: string[] = [];

    await harness.run([scenario()], {
      onEvent: (event) => seen.push(event.type),
    });

    expect(seen).toEqual(['scenario_start', 'turn', 'turn', 'scenario_end']);
  });
});

describe('ConversationEvaluatorService', () => {
  function judging(judgeReply: RoutedReply | Error): RoutedHandler {
    return (context) => {
      if (context.participant !== 'judge') return searchThenAnswer(context);
      if (judgeReply instanceof Error) throw judgeReply;
      return judgeReply;
    };
  }

  function verdict(
    criteria: { id: string; passed: boolean; reasoning?: string }[],
    summary: string,
  ) {
    return { text: JSON.stringify({ criteria, summary }) };
  }

  const mixedRubric: Rubric = {
    criteria: [
      {
        id: 'searched-catalog',
        description: 'The assistant searched the catalog.',
        check: check.calledTool(SEARCH_PRODUCTS),
      },
      {
        id: 'tone',
        description: 'The assistant was warm and concise.',
      },
    ],
  };

  it('combines deterministic checks with judged criteria', async () => {
    const { harness } = createHarness(
      judging(
        verdict(
          [{ id: 'tone', passed: false, reasoning: 'Polite but a little flat.' }],
          'Solid retrieval, unremarkable delivery.',
        ),
      ),
    );

    const { evaluation } = await harness.runScenario(scenario({ rubric: mixedRubric }));

    expect(evaluation.criteria.map((criterion) => criterion.source)).toEqual(['check', 'judge']);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.summary).toBe('Solid retrieval, unremarkable delivery.');
    expect(evaluation.criteria[1].reasoning).toBe('Polite but a little flat.');
  });

  it('sends the tool trace to the judge so grounding can be assessed', async () => {
    const { harness, llm } = createHarness(judging(verdict([{ id: 'tone', passed: true }], 'Good.')));

    await harness.runScenario(scenario({ rubric: mixedRubric }));

    const prompt = String(llm.requestsFrom('judge')[0].messages[1].content);
    expect(prompt).toContain('- tone: The assistant was warm and concise.');
    expect(prompt).toContain(`[tool] ${SEARCH_PRODUCTS}`);
    expect(prompt).toContain('SHOPPER: show me your laptops');
    expect(prompt).toContain(`ASSISTANT: ${ANSWER}`);
  });

  it('makes one judge call for the whole rubric rather than one per criterion', async () => {
    const { harness, llm } = createHarness(judging(verdict([{ id: 'tone', passed: true }], 'Good.')));

    await harness.runScenario(scenario({ rubric: mixedRubric }));

    expect(llm.requestsFrom('judge')).toHaveLength(1);
  });

  it('fails the scenario when any criterion fails, even if others pass', async () => {
    const { harness } = createHarness(
      judging(verdict([{ id: 'quality', passed: true, reasoning: 'Excellent.' }], 'Great.')),
    );

    const { evaluation } = await harness.runScenario(
      scenario({
        rubric: {
          criteria: [
            { id: 'quality', description: 'The conversation was excellent.' },
            {
              id: 'looked-up-details',
              description: 'The assistant fetched details for the product discussed.',
              required: true,
              check: check.calledTool(GET_PRODUCT_DETAILS),
            },
          ],
        },
      }),
    );

    expect(evaluation.criteria[0].passed).toBe(true);
    expect(evaluation.criteria[1].passed).toBe(false);
    expect(evaluation.passed).toBe(false);
  });

  it('does not fail the scenario when only an advisory criterion fails', async () => {
    const { harness } = createHarness(
      judging(verdict([{ id: 'tone', passed: false, reasoning: 'A bit flat.' }], 'Okay.')),
    );

    const { evaluation } = await harness.runScenario(
      scenario({
        rubric: {
          criteria: [
            {
              id: 'searched-catalog',
              description: 'The assistant searched the catalog.',
              required: true,
              check: check.calledTool(SEARCH_PRODUCTS),
            },
            {
              id: 'tone',
              description: 'The assistant was warm and concise.',
            },
          ],
        },
      }),
    );

    expect(evaluation.criteria[0].passed).toBe(true);
    expect(evaluation.criteria[1].passed).toBe(false);
    // The required criterion passed, so the advisory failure does not fail the run.
    expect(evaluation.passed).toBe(true);
  });

  it('flags a judge outage instead of blaming the agent', async () => {
    const { harness } = createHarness(judging(new Error('judge rate limited')));

    const { evaluation } = await harness.runScenario(scenario({ rubric: mixedRubric }));

    expect(evaluation.judgeError).toContain('judge rate limited');
    expect(evaluation.criteria[1].passed).toBe(false);
    expect(evaluation.criteria[1].reasoning).toContain('the judge failed');
    // The deterministic half of the rubric still evaluated normally.
    expect(evaluation.criteria[0].passed).toBe(true);
  });

  it('fails a criterion the judge skipped rather than dropping it', async () => {
    const { harness } = createHarness(judging(verdict([], 'No comment.')));

    const { evaluation } = await harness.runScenario(scenario({ rubric: mixedRubric }));

    expect(evaluation.criteria).toHaveLength(2);
    expect(evaluation.criteria[1]).toMatchObject({
      id: 'tone',
      passed: false,
      reasoning: 'The judge did not score this criterion.',
    });
  });

  it('recovers a verdict wrapped in prose or a code fence', async () => {
    const { harness } = createHarness(
      judging({
        text: 'Sure! ```json\n{"criteria":[{"id":"tone","passed":true}],"summary":"Warm."}\n```',
      }),
    );

    const { evaluation } = await harness.runScenario(scenario({ rubric: mixedRubric }));

    expect(evaluation.criteria[1].passed).toBe(true);
    expect(evaluation.summary).toBe('Warm.');
  });

  it('skips the judge entirely for an all-deterministic rubric', async () => {
    const { harness, llm } = createHarness(judging(new Error('the judge must not be called')));

    const { evaluation } = await harness.runScenario(scenario());

    expect(llm.requestsFrom('judge')).toHaveLength(0);
    expect(evaluation.passed).toBe(true);
  });
});
