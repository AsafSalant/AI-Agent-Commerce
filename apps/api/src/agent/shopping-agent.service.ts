import { Agent } from '@mastra/core/agent';
import type { CoreMessage, MastraModelConfig } from '@mastra/core/llm';
import { isValidationError } from '@mastra/core/tools';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ChatMessage,
  MessageWidget,
  ProductCategory,
  ToolTraceEntry,
} from '@shopping-copilot/shared';
import { ProductsService } from '../products/products.service';
import { MemoryService } from '../memory/memory.service';
import type { AgentEvent, AgentRunOptions, ToolOutcome } from './agent.types';
import {
  AGENT_MODEL,
  GUARD_MODEL,
  MASTRA_PLATFORM_ACCESS_TOKEN,
  MASTRA_PROJECT_ID,
  TITLE_MODEL,
} from './model.tokens';
import { buildInstructions, buildTurnContext, describeShownProducts } from './prompts';
import { sanitizeShopperInput } from './sanitize';
import { createShoppingMastra } from './shopping.agent';
import { createShoppingTools, describeToolCall } from './tools';

/** Tool-calling rounds allowed per user turn before the agent must answer. */
const MAX_STEPS = 8;
const MAX_HISTORY_MESSAGES = 24;
/** Ceiling on the spoken answer; the product cards carry the detail. */
const MAX_ANSWER_TOKENS = 700;
const MAX_TITLE_TOKENS = 30;

const BLOCKED_TEXT =
  "I can only help with finding products in this store, and that message looks like it is trying to steer me elsewhere. What are you shopping for?";

/**
 * The conversational core: turns shopper messages into catalog retrieval plus a
 * short spoken answer, streaming both as they become available.
 *
 * Mastra runs the loop and the guardrails; this service owns the seam between it
 * and the rest of the app. History arrives from our conversation store on every
 * turn and the reply leaves as `AgentEvent`s, so nothing downstream — the SSE
 * contract, the widgets, the stored `toolTrace` — knows which engine is inside.
 */
@Injectable()
export class ShoppingAgentService {
  private readonly logger = new Logger(ShoppingAgentService.name);
  private readonly agent: Agent;
  private readonly titleAgent: Agent;
  private lastKnownCategories: ProductCategory[] = [];

  constructor(
    private readonly products: ProductsService,
    private readonly memory: MemoryService,
    @Inject(AGENT_MODEL) model: MastraModelConfig,
    @Inject(TITLE_MODEL) titleModel: MastraModelConfig,
    @Inject(GUARD_MODEL) guardModel: MastraModelConfig | null,
    @Inject(MASTRA_PLATFORM_ACCESS_TOKEN) platformAccessToken: string | null,
    @Inject(MASTRA_PROJECT_ID) platformProjectId: string | null,
  ) {
    const { agent, titleAgent } = createShoppingMastra({
      model,
      tools: createShoppingTools(products, memory),
      titleModel,
      ...(guardModel ? { guardModel } : {}),
      ...(platformAccessToken && platformProjectId
        ? { platformAccessToken, platformProjectId }
        : {}),
    });
    this.agent = agent;
    this.titleAgent = titleAgent;
  }

  /**
   * Runs one shopper turn. Yields incremental events and finishes with a
   * `result` event holding the message that should be persisted.
   */
  async *run(
    history: ChatMessage[],
    userContent: string,
    options: AgentRunOptions = {},
  ): AsyncGenerator<AgentEvent> {
    // Layout matters for prompt caching: the instructions and the history form a
    // prefix that only grows at the end, so the clock rides along with the new
    // turn instead of sitting in the prompt. It goes in the user message rather
    // than a system one because Mastra hoists every system message to the front,
    // ahead of the history it is meant to follow.
    const context = buildTurnContext({
      now: new Date(),
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    });
    const memoryBlock = (await this.memory.describeFacts()) ?? '';
    const prefix = memoryBlock ? `${context}\n\n${memoryBlock}` : context;
    const messages: CoreMessage[] = [
      ...this.toModelMessages(history),
      { role: 'user', content: `${prefix}\n\n${sanitizeShopperInput(userContent)}` },
    ];

    const widgets: MessageWidget[] = [];
    const toolTrace: ToolTraceEntry[] = [];
    const startedAt = new Map<string, number>();
    let text = '';
    let blockedReason: string | null = null;

    const stream = await this.agent.stream(messages, {
      // Overrides the agent's own instructions so the category list can be
      // folded into the cached prefix. Same content every turn, so the prefix
      // stays byte-identical and the cache keeps hitting.
      instructions: {
        role: 'system',
        content: buildInstructions(await this.knownCategories()),
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
      maxSteps: MAX_STEPS,
      modelSettings: { maxOutputTokens: MAX_ANSWER_TOKENS },
      ...(options.conversationId
        ? { providerOptions: { openai: { promptCacheKey: options.conversationId } } }
        : {}),
    });

    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case 'text-delta': {
          const delta = chunk.payload.text;
          if (!delta) break;
          text += delta;
          yield { type: 'text_delta', delta };
          break;
        }

        // Announced as soon as the model has committed to the call, so the
        // shopper sees what is being looked up while the catalog answers.
        case 'tool-call': {
          const { toolCallId, toolName, args } = chunk.payload;
          startedAt.set(toolCallId, Date.now());
          yield {
            type: 'tool_activity',
            activity: {
              id: toolCallId,
              label: describeToolCall(toolName, toolArgs(args)),
              state: 'running',
            },
          };
          break;
        }

        case 'tool-result': {
          const { toolCallId, toolName, args, result } = chunk.payload;
          const outcome = asOutcome(result, toolName, toolArgs(args));

          yield {
            type: 'tool_activity',
            activity: {
              id: toolCallId,
              label: outcome.statusLabel,
              state: outcome.error ? 'error' : 'done',
            },
          };

          toolTrace.push({
            name: toolName,
            args: toolArgs(args),
            resultCount: outcome.resultCount,
            durationMs: Date.now() - (startedAt.get(toolCallId) ?? Date.now()),
            label: outcome.statusLabel,
            ...(outcome.error ? { error: outcome.error } : {}),
          });

          if (outcome.widget) {
            widgets.push(outcome.widget);
            yield { type: 'widget', widget: outcome.widget };
          }
          break;
        }

        // A tool the model called with arguments the schema rejects, or one that
        // threw. Mastra hands the reason back to the model, which gets another
        // step to correct itself; we only record that the call happened.
        case 'tool-error': {
          const { toolCallId, toolName, args, error } = chunk.payload;
          const reason = error instanceof Error ? error.message : String(error);
          const label = `${describeToolCall(toolName, toolArgs(args))} failed`;
          this.logger.warn(`Tool ${toolName} failed: ${reason}`);

          yield { type: 'tool_activity', activity: { id: toolCallId, label, state: 'error' } };
          toolTrace.push({
            name: toolName,
            args: toolArgs(args),
            resultCount: 0,
            durationMs: Date.now() - (startedAt.get(toolCallId) ?? Date.now()),
            label,
            error: reason,
          });
          break;
        }

        // An input processor refused the turn — the injection classifier, in
        // practice. The turn ends here rather than reaching the model.
        case 'tripwire':
          blockedReason = chunk.payload.reason;
          break;

        case 'error':
          throw chunk.payload.error instanceof Error
            ? chunk.payload.error
            : new Error(String(chunk.payload.error));

        default:
          break;
      }
    }

    if (blockedReason) {
      this.logger.warn(`Turn blocked by an input processor: ${blockedReason}`);
      yield { type: 'result', content: BLOCKED_TEXT, widgets: [], toolTrace };
      return;
    }

    const content = text.trim() || this.fallbackText(widgets.length > 0);
    yield { type: 'result', content, widgets, toolTrace };
  }

  /** Short sidebar title for a conversation, derived from its first message. */
  async generateTitle(userContent: string): Promise<string> {
    const clean = sanitizeShopperInput(userContent);
    const fallback = clean.trim().split(/\s+/).slice(0, 6).join(' ').slice(0, 60);
    try {
      const result = await this.titleAgent.generate(clean.slice(0, 500), {
        modelSettings: { maxOutputTokens: MAX_TITLE_TOKENS },
      });
      const cleaned = (result.text ?? '')
        .trim()
        .replace(/^["'`]|["'`.]$/g, '')
        .trim();
      return cleaned.length >= 3 ? cleaned.slice(0, 60) : fallback;
    } catch (error) {
      this.logger.warn(
        `Title generation failed, using fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return fallback;
    }
  }

  private fallbackText(hasProducts: boolean): string {
    return hasProducts
      ? 'Here is what I found in the catalog — let me know if you want to narrow it down.'
      : "I could not find anything matching that in the catalog. Could you tell me a bit more about what you're after?";
  }

  /**
   * The category list now sits in the cached prompt prefix, so a blip in the
   * catalog must not change it: the last good list is reused instead. Dropping
   * to an empty list on a transient failure would rewrite the prefix for every
   * conversation at once, and again when the catalog came back.
   */
  private async knownCategories(): Promise<ProductCategory[]> {
    try {
      const categories = await this.products.getCategories();
      if (categories.length > 0) this.lastKnownCategories = categories;
    } catch (error) {
      this.logger.warn(
        `Could not refresh the catalog categories, reusing the last known list: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return this.lastKnownCategories;
  }

  /** Replays stored history, including which product cards were shown. */
  private toModelMessages(history: ChatMessage[]): CoreMessage[] {
    return history.slice(-MAX_HISTORY_MESSAGES).map((message): CoreMessage => {
      if (message.role === 'user') {
        return { role: 'user', content: message.content };
      }
      const shown = describeShownProducts(message);
      return {
        role: 'assistant',
        content: shown ? `${message.content}\n\n${shown}` : message.content,
      };
    });
  }
}

/**
 * Tool results are normally our own `ToolOutcome`, but Mastra answers a call
 * whose arguments fail the input schema with a validation error instead. Both
 * end up as one shape, so the trace and the status line stay uniform.
 */
function asOutcome(result: unknown, toolName: string, args: Record<string, unknown>): ToolOutcome {
  if (result && typeof result === 'object' && 'statusLabel' in result) {
    return result as ToolOutcome;
  }

  return {
    model: '',
    resultCount: 0,
    statusLabel: `${describeToolCall(toolName, args)} failed`,
    error: isValidationError(result) ? result.message : 'invalid arguments',
  };
}

/** Mastra tags tool arguments with its own metadata; the trace keeps the model's. */
function toolArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {};
  const { __mastraMetadata: _ignored, ...rest } = args as Record<string, unknown>;
  return rest;
}
