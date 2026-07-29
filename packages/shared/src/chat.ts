import type { Product, ProductSearchFilters } from './products';

export type MessageRole = 'user' | 'assistant';

/**
 * A product carousel/grid rendered inside an assistant message. Widgets are
 * persisted with the message so a reloaded conversation renders identically.
 */
export interface ProductListWidget {
  type: 'product_list';
  id: string;
  heading: string;
  products: Product[];
  /** Total matches available, which can exceed `products.length`. */
  total: number;
  filters: ProductSearchFilters;
}

export type MessageWidget = ProductListWidget;

/** Trace of a single tool call, surfaced in the UI as a collapsible detail. */
export interface ToolTraceEntry {
  name: string;
  args: Record<string, unknown>;
  resultCount: number;
  durationMs: number;
  /** Shopper-facing summary of the call, e.g. "Retrieved 24 categories". */
  label?: string;
  error?: string;
}

export type ToolActivityState = 'running' | 'done' | 'error';

/**
 * One catalog call as the shopper watches it happen: a line that starts as
 * "Searching the catalog" and settles into "Found 6 products". Identified by
 * the tool call id so the running line is replaced rather than appended to.
 */
export interface ToolActivity {
  id: string;
  label: string;
  state: ToolActivityState;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  widgets: MessageWidget[];
  toolTrace?: ToolTraceEntry[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
}

export interface SendMessageRequest {
  content: string;
  /**
   * IANA timezone the shopper's wall-clock runs in, so "today" and "this week"
   * line up with the shopper's calendar rather than the API host's. Optional:
   * omitted by older clients and by the non-streaming test path, in which case
   * the API falls back to its own zone.
   */
  timeZone?: string;
}

/** Response of the non-streaming send endpoint (used by tests and integrations). */
export interface SendMessageResponse {
  conversationId: string;
  title: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export function toConversationSummary(conversation: Conversation): ConversationSummary {
  const last = conversation.messages[conversation.messages.length - 1];
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    lastMessagePreview: last ? last.content.slice(0, 140) : '',
  };
}
