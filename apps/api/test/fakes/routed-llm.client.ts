import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions';
import { LlmClient } from '../../src/agent/llm.client';
import type { LlmRequest } from '../../src/agent/llm.types';
import { ScriptedModel, type ModelRequest, type ScriptedToolCall } from './scripted-model';

/**
 * Who a request came from. During a simulation the agent, the simulated shopper
 * and the judge all share one `LlmClient`, and their calls interleave, so a
 * sequential script (see `FakeLlmClient`) cannot express the expected traffic.
 */
export type Participant = 'agent' | 'shopper' | 'judge' | 'title';

export interface RoutedReply {
  text?: string;
  toolCalls?: ScriptedToolCall[];
}

export interface RoutedContext {
  participant: Participant;
  /** The prompt as that participant's client saw it. */
  request: LlmRequest | ModelRequest;
  /** How many requests this participant has already made. */
  turn: number;
  /**
   * True when the agent must answer in words: its tool results are back, or the
   * loop reached its final step and forbade further tool calls.
   */
  awaitingAnswer: boolean;
}

export type RoutedHandler = (context: RoutedContext) => RoutedReply;

/**
 * The agent side of a simulation, now that Mastra owns its loop: the same
 * handler answers on the model seam, so one function still scripts the whole
 * cast — shopper, judge and agent alike.
 */
export function routedAgentModel(handler: RoutedHandler): ScriptedModel {
  return new ScriptedModel(
    ({ request, turn, awaitingAnswer }) =>
      handler({ participant: 'agent', request, turn, awaitingAnswer }),
    'test-model',
  );
}

/** Identifies a participant from the system prompt it was given. */
export function participantOf(request: LlmRequest): Participant {
  const system = request.messages.find((message) => message.role === 'system')?.content;
  const prompt = typeof system === 'string' ? system : '';
  if (prompt.includes('role-playing a SHOPPER')) return 'shopper';
  if (prompt.includes('strict evaluator')) return 'judge';
  if (prompt.startsWith('Write a 2-5 word title')) return 'title';
  return 'agent';
}

/**
 * Replays model turns routed by participant, so a whole simulated conversation —
 * shopper, agent and judge — runs deterministically without a network or a key.
 */
export class RoutedLlmClient extends LlmClient {
  readonly requests: LlmRequest[] = [];
  private readonly turns = new Map<Participant, number>();

  constructor(private readonly handler: RoutedHandler) {
    super();
  }

  requestsFrom(participant: Participant): LlmRequest[] {
    return this.requests.filter((request) => participantOf(request) === participant);
  }

  async complete(request: LlmRequest): Promise<ChatCompletion> {
    const reply = this.dispatch(request);
    return {
      id: 'routed-completion',
      object: 'chat.completion',
      created: 0,
      model: request.model,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          logprobs: null,
          message: { role: 'assistant', content: reply.text ?? '', refusal: null },
        },
      ],
    } as ChatCompletion;
  }

  async stream(request: LlmRequest): Promise<AsyncIterable<ChatCompletionChunk>> {
    const reply = this.dispatch(request);
    // Honour a `none` tool choice so a careless handler cannot spin the agent.
    const toolCalls = request.toolChoice === 'none' ? [] : (reply.toolCalls ?? []);
    return replay(reply.text ?? '', toolCalls);
  }

  private dispatch(request: LlmRequest): RoutedReply {
    const participant = participantOf(request);
    const turn = this.turns.get(participant) ?? 0;
    this.turns.set(participant, turn + 1);
    this.requests.push(request);

    return this.handler({
      participant,
      request,
      turn,
      awaitingAnswer:
        request.toolChoice === 'none' ||
        request.messages.some((message) => message.role === 'tool'),
    });
  }
}

async function* replay(
  text: string,
  toolCalls: ScriptedToolCall[],
): AsyncGenerator<ChatCompletionChunk> {
  for (const word of text.split(' ').filter(Boolean)) {
    yield chunk({ content: `${word} ` });
  }

  for (const [index, call] of toolCalls.entries()) {
    yield chunk({
      tool_calls: [
        {
          index,
          id: `call_${index}`,
          type: 'function',
          function: { name: call.name, arguments: '' },
        },
      ],
    });
    // Arguments arrive split across chunks, exactly as the API delivers them.
    const serialized = JSON.stringify(call.args);
    const midpoint = Math.ceil(serialized.length / 2);
    for (const part of [serialized.slice(0, midpoint), serialized.slice(midpoint)]) {
      yield chunk({ tool_calls: [{ index, function: { arguments: part } }] });
    }
  }
}

function chunk(delta: ChatCompletionChunk.Choice['delta']): ChatCompletionChunk {
  return {
    id: 'chunk',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'fake-model',
    choices: [{ index: 0, delta, finish_reason: null }],
  } as ChatCompletionChunk;
}
