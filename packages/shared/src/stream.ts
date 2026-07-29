import type { ChatMessage, MessageWidget, ToolActivity } from './chat';

/**
 * Server-sent events emitted while the agent answers a message. The client
 * renders `text_delta` incrementally and appends `widget` payloads to the
 * in-flight assistant bubble; `message` carries the authoritative persisted
 * version that replaces the optimistic one.
 *
 * `tool_activity` arrives twice per catalog call — once when it starts and
 * once when it finishes — carrying the same id both times.
 */
export type ChatStreamEvent =
  | { type: 'user_message'; message: ChatMessage }
  | { type: 'tool_activity'; activity: ToolActivity }
  | { type: 'text_delta'; delta: string }
  | { type: 'widget'; widget: MessageWidget }
  | { type: 'message'; message: ChatMessage }
  | { type: 'title'; conversationId: string; title: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export const CHAT_STREAM_EVENT_NAME = 'chat';
