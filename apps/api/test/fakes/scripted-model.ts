import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from '@ai-sdk/provider-v5';

export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** One scripted model turn: some text, some tool calls, or both. */
export interface ScriptedTurn {
  text?: string;
  toolCalls?: ScriptedToolCall[];
}

/** A prompt as the model received it, flattened so tests can assert on it. */
export interface ModelRequest {
  modelId: string;
  messages: { role: string; content: string }[];
  toolNames: string[];
  providerOptions?: Record<string, unknown>;
}

export interface ScriptedContext {
  request: ModelRequest;
  /** How many calls this model has already served. */
  turn: number;
  /** True once tool results are back, so the model is expected to answer in words. */
  awaitingAnswer: boolean;
}

export type ScriptedResolver = (context: ScriptedContext) => ScriptedTurn;

const USAGE: LanguageModelV2Usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20 };

/**
 * A `LanguageModelV2` that replays scripted turns, which is the seam Mastra
 * gives us in place of the old `LlmClient`: the agent loop, tool dispatch,
 * processors and SSE plumbing all run for real, while the model itself is
 * deterministic and offline.
 */
export class ScriptedModel implements LanguageModelV2 {
  readonly specificationVersion = 'v2';
  readonly provider = 'scripted';
  readonly supportedUrls = {};
  readonly requests: ModelRequest[] = [];

  private resolve: ScriptedResolver;
  private turn = 0;

  constructor(
    resolver: ScriptedResolver | ScriptedTurn[],
    readonly modelId = 'scripted-model',
  ) {
    this.resolve = toResolver(resolver);
  }

  /** Re-arms the model between test cases that share one Nest application. */
  reset(resolver: ScriptedResolver | ScriptedTurn[]): void {
    this.resolve = toResolver(resolver);
    this.turn = 0;
    this.requests.length = 0;
  }

  async doStream(options: LanguageModelV2CallOptions) {
    const turn = this.take(options);

    return {
      stream: new ReadableStream<LanguageModelV2StreamPart>({
        start(controller) {
          for (const part of streamParts(turn)) controller.enqueue(part);
          controller.close();
        },
      }),
    };
  }

  async doGenerate(options: LanguageModelV2CallOptions) {
    const turn = this.take(options);
    const content: LanguageModelV2Content[] = turn.text
      ? [{ type: 'text' as const, text: turn.text }]
      : [];

    return {
      content,
      finishReason: 'stop' as LanguageModelV2FinishReason,
      usage: USAGE,
      warnings: [],
    };
  }

  private take(options: LanguageModelV2CallOptions): ScriptedTurn {
    const request = flatten(options, this.modelId);
    this.requests.push(request);
    const turn = this.turn;
    this.turn += 1;

    return this.resolve({
      request,
      turn,
      awaitingAnswer: request.messages.some((message) => message.role === 'tool'),
    });
  }
}

function toResolver(resolver: ScriptedResolver | ScriptedTurn[]): ScriptedResolver {
  if (typeof resolver === 'function') return resolver;
  return ({ turn }) => resolver[turn] ?? { text: 'Anything else I can help you find?' };
}

function* streamParts(turn: ScriptedTurn): Generator<LanguageModelV2StreamPart> {
  yield { type: 'stream-start', warnings: [] };

  if (turn.text) {
    yield { type: 'text-start', id: 'text-0' };
    // Word by word, so the SSE layer is exercised the way a real model drives it.
    for (const word of turn.text.split(' ').filter(Boolean)) {
      yield { type: 'text-delta', id: 'text-0', delta: `${word} ` };
    }
    yield { type: 'text-end', id: 'text-0' };
  }

  for (const [index, call] of (turn.toolCalls ?? []).entries()) {
    const id = `call_${index}`;
    const input = JSON.stringify(call.args);

    yield { type: 'tool-input-start', id, toolName: call.name };
    yield { type: 'tool-input-delta', id, delta: input };
    yield { type: 'tool-input-end', id };
    yield { type: 'tool-call', toolCallId: id, toolName: call.name, input };
  }

  yield {
    type: 'finish',
    finishReason: (turn.toolCalls?.length ? 'tool-calls' : 'stop') as LanguageModelV2FinishReason,
    usage: USAGE,
  };
}

/** Collapses the provider prompt into `{ role, content }` pairs for assertions. */
function flatten(options: LanguageModelV2CallOptions, modelId: string): ModelRequest {
  const messages = options.prompt.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content };
    }

    const content = message.content
      .map((part) => {
        if (part.type === 'text') return part.text;
        if (part.type === 'tool-result') return textOf(part.output);
        if (part.type === 'tool-call') return JSON.stringify(part.input);
        return '';
      })
      .join('\n');
    return { role: message.role, content };
  });

  return {
    modelId,
    messages,
    toolNames: (options.tools ?? []).map((tool) => tool.name),
    ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
  };
}

/** Tool results reach the model as typed output parts; tests want the text. */
function textOf(output: unknown): string {
  if (output && typeof output === 'object' && 'value' in output) {
    const { value } = output as { value: unknown };
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return JSON.stringify(output);
}
