import type { ChatStreamEvent, Conversation, ConversationSummary } from '@shopping-copilot/shared';
import { readSseStream } from './sse';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * The shopper's wall-clock timezone, so "today" and "this week" line up with
 * their calendar rather than the API host's. Resolved once per session: the
 * zone does not change while a tab is open, and re-resolving per turn would
 * just add noise to the request body.
 */
const SHOPPER_TIME_ZONE = resolveShopperTimeZone();
function resolveShopperTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(await describeError(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function describeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    if (message) return message;
  } catch {
    // fall through to the status text
  }
  return `Request failed with status ${response.status}`;
}

export const api = {
  listConversations: () => request<ConversationSummary[]>('/api/conversations'),

  getConversation: (id: string) => request<Conversation>(`/api/conversations/${id}`),

  createConversation: () =>
    request<Conversation>('/api/conversations', { method: 'POST', body: JSON.stringify({}) }),

  renameConversation: (id: string, title: string) =>
    request<Conversation>(`/api/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  deleteConversation: (id: string) =>
    request<void>(`/api/conversations/${id}`, { method: 'DELETE' }),

  /** Streams one shopper turn as a sequence of chat events. */
  async *sendMessage(
    conversationId: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const response = await fetch(`${BASE_URL}/api/conversations/${conversationId}/messages/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ content, timeZone: SHOPPER_TIME_ZONE }),
      signal,
    });

    if (!response.ok) {
      throw new Error(await describeError(response));
    }

    yield* readSseStream<ChatStreamEvent>(response);
  },
};
