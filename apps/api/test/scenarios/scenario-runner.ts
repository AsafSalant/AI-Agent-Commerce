import { ConfigService } from '@nestjs/config';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { ChatMessage } from '@shopping-copilot/shared';
import { config as loadEnv } from 'dotenv';
import { OpenAiLlmClient } from '../../src/agent/llm.client';
import { ShoppingAgentService } from '../../src/agent/shopping-agent.service';
import { ENV_FILE_PATHS } from '../../src/config/env';
import { AGENT_MODEL_NAME } from '../../src/config/models';
import type { DummyJsonClient } from '../../src/products/dummyjson.client';
import { ProductsService } from '../../src/products/products.service';
import { buildSimulatedMessage, ShoppingAgentUnderTest } from '../../src/simulation';
import { FakeDummyJsonClient } from '../fakes/fake-dummyjson.client';
import { FakeMemoryService } from '../fakes/fake-memory.service';
import { ScriptedModel } from '../fakes/scripted-model';
import { AgentEvaluator, renderTranscript, type ScenarioVerdict } from './agent-evaluator';
import { MockUserAgent } from './mock-user.agent';

// Scenarios run against live models, so the repo .env must be readable from jest.
loadEnv({ path: ENV_FILE_PATHS, quiet: true });

/**
 * The anatomy of a scenario, readable top to bottom:
 *
 *   context         — the past. Messages that already happened, replayed as
 *                     history verbatim. They are NEVER re-run through the agent.
 *   messages        — the present. The turns to run, in order: each user message
 *                     goes to the real agent, and the agent's reply is captured
 *                     before the next message is sent.
 *   successCriteria — the verdict. Free text the evaluator (`agent-evaluator.ts`)
 *                     judges the whole transcript against after the run.
 */
export interface TestScenario {
  id: string;
  title: string;
  context?: ContextMessage[];
  messages: TestMessage[];
  successCriteria: string;
}

/** A message from the past: `{ user: ... }` the shopper said it, `{ agent: ... }` the assistant did. */
export type ContextMessage = { user: string } | { agent: string };

/**
 * A turn to run.
 * `{ user: ... }` sends the message verbatim. `{ mockUser: ... }` hands a
 * director's note to the mock shopper (`mock-user.agent.ts`), which writes the
 * message while looking at the conversation — for turns that must react to
 * what the agent actually showed.
 */
export type TestMessage = { user: string } | { mockUser: string };

export interface ScenarioResult {
  /** The transcript as the evaluator saw it. Printed when a scenario fails. */
  transcript: string;
  verdict: ScenarioVerdict;
  /** The full conversation, context messages included. */
  messages: ChatMessage[];
}

/**
 * Runs one scenario end to end: seeds the context, sends each message to the
 * real agent in turn, then hands the transcript to the evaluator.
 */
export async function runScenario(scenario: TestScenario): Promise<ScenarioResult> {
  const harness = getHarness();

  const history: ChatMessage[] = (scenario.context ?? []).map((message) =>
    'user' in message
      ? buildSimulatedMessage('user', message.user)
      : buildSimulatedMessage('assistant', message.agent),
  );

  for (const [index, message] of scenario.messages.entries()) {
    const userText =
      'user' in message
        ? message.user
        : await harness.mockUser.compose({ history, direction: message.mockUser });

    const turn = await harness.agent.generate(history, userText);
    if (turn.error) {
      throw new Error(`The agent itself failed on turn ${index + 1} of "${scenario.id}": ${turn.error}`);
    }

    history.push(buildSimulatedMessage('user', userText), turn.message);
  }

  const transcript = renderTranscript(history);
  const verdict = await harness.evaluator.evaluate({
    title: scenario.title,
    successCriteria: scenario.successCriteria,
    transcript,
  });

  return { transcript, verdict, messages: history };
}

interface LiveHarness {
  agent: ShoppingAgentUnderTest;
  mockUser: MockUserAgent;
  evaluator: AgentEvaluator;
}

let harness: LiveHarness | null = null;

/**
 * One harness per test file: the real agent (real model, real tool loop) over
 * the fixture catalog, plus the two models that surround it. The catalog is
 * fake on purpose — the products never change between runs, so a failure means
 * the model behaved differently, not the store.
 */
function getHarness(): LiveHarness {
  if (harness) return harness;

  const config = new ConfigService();
  const llm = new OpenAiLlmClient(config);
  const model = AGENT_MODEL_NAME;

  const products = new ProductsService(new FakeDummyJsonClient() as unknown as DummyJsonClient);
  const agent = new ShoppingAgentService(
    products,
    new FakeMemoryService(),
    `openai/${model}` as MastraModelConfig,
    new ScriptedModel([]), // the title model is never exercised by scenarios
    null, // no injection classifier: one less live call per turn
    null,
    null,
  );

  harness = {
    agent: new ShoppingAgentUnderTest(agent),
    mockUser: new MockUserAgent(llm, model),
    evaluator: new AgentEvaluator(llm, model),
  };
  return harness;
}
