/**
 * Every type the agent module publishes. Kept apart from the services and
 * factories that use them, so those files read as behaviour alone and a caller
 * can depend on the shape of a turn without importing the Nest wiring.
 */

import type { MastraModelConfig } from '@mastra/core/llm';
import type { MessageWidget, ToolActivity, ToolTraceEntry } from '@shopping-copilot/shared';
import type { z } from 'zod';
import type { searchProductsArgsSchema } from './tool.schemas';
import type { createShoppingTools } from './tools';

/** What one shopper turn emits, in the order the SSE layer forwards it. */
export type AgentEvent =
  | { type: 'tool_activity'; activity: ToolActivity }
  | { type: 'text_delta'; delta: string }
  | { type: 'widget'; widget: MessageWidget }
  | { type: 'result'; content: string; widgets: MessageWidget[]; toolTrace: ToolTraceEntry[] };

export interface AgentRunOptions {
  /** Used as the provider's prompt cache key, so a thread keeps hitting the same cache. */
  conversationId?: string;
  /** IANA timezone for the turn's clock; falls back to the host zone when unset. */
  timeZone?: string;
}

/** Everything `buildTurnContext` needs to render the per-turn `<context>` block. */
export interface TurnContext {
  now: Date;
  /** IANA zone the wall-clock time is rendered in. Defaults to the host zone. */
  timeZone?: string;
}

export interface ShoppingAgentConfig {
  model: MastraModelConfig;
  tools: ShoppingTools;
  titleModel: MastraModelConfig;
  /**
   * Small model backing the injection classifier. Leave unset to run without it:
   * the deterministic defences in `sanitize.ts` and the data blocks still apply,
   * and tests stay offline and free of a second model call per turn.
   */
  guardModel?: MastraModelConfig;
  /**
   * Mastra Platform credentials. When both are present, traces and metrics are
   * shipped to the dashboard; when absent, the agent runs unobserved — which is
   * what tests and local dev need.
   */
  platformAccessToken?: string;
  platformProjectId?: string;
}

/**
 * What a tool hands back. The model only ever sees `model` — the compact data
 * block — while the widget, status label and counts stay on our side of the
 * boundary, so six products of JSON are not paid for twice.
 */
export interface ToolOutcome {
  model: string;
  widget?: MessageWidget;
  /** How the finished call reads in the shopper's checklist, past tense. */
  statusLabel: string;
  resultCount: number;
  error?: string;
}

export type SearchProductsArgs = z.infer<typeof searchProductsArgsSchema>;

/** The catalog tool set as Mastra receives it, keyed by tool id. */
export type ShoppingTools = ReturnType<typeof createShoppingTools>;
