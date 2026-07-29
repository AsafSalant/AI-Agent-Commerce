import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChatMessage,
  Conversation,
  ConversationSummary,
  MessageWidget,
  ToolActivity,
} from '@shopping-copilot/shared';
import { api } from '@/lib/api';

const ACTIVE_CONVERSATION_KEY = 'shopper.activeConversationId';

/** The assistant turn currently being streamed, before it is persisted. */
export interface PendingAssistant {
  content: string;
  widgets: MessageWidget[];
  /** Catalog calls in the order they started, each flipping to done in place. */
  activities: ToolActivity[];
}

/** A second event for a call replaces its line, so the checklist never repeats. */
function upsertActivity(activities: ToolActivity[], activity: ToolActivity): ToolActivity[] {
  const index = activities.findIndex((item) => item.id === activity.id);
  if (index === -1) return [...activities, activity];
  return activities.map((item, position) => (position === index ? activity : item));
}

function summarize(conversation: Conversation): ConversationSummary {
  const last = conversation.messages[conversation.messages.length - 1];
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    lastMessagePreview: last?.content.slice(0, 140) ?? '',
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

/**
 * Owns all chat state. The API is the source of truth for history — the browser
 * only remembers which conversation was open, so a refresh restores the exact
 * thread including its product widgets.
 */
export function useCopilot() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingAssistant | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);

  const remember = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
    try {
      if (id) localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
      else localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    } catch {
      // Private browsing modes can reject storage; history still lives server-side.
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
    } catch (cause) {
      setError(toMessage(cause));
    }
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      setIsLoadingConversation(true);
      setError(null);
      setPending(null);
      try {
        const conversation = await api.getConversation(id);
        remember(conversation.id);
        setMessages(conversation.messages);
      } catch (cause) {
        setError(toMessage(cause));
      } finally {
        setIsLoadingConversation(false);
      }
    },
    [remember],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const list = await api.listConversations();
        if (cancelled) return;
        setConversations(list);

        const stored = ((): string | null => {
          try {
            return localStorage.getItem(ACTIVE_CONVERSATION_KEY);
          } catch {
            return null;
          }
        })();

        // Only the explicitly remembered conversation is reopened. Falling back
        // to the newest one would drag the shopper back into an old thread
        // after they started a new conversation and refreshed.
        if (stored && list.some((item) => item.id === stored)) {
          const conversation = await api.getConversation(stored);
          if (cancelled) return;
          remember(conversation.id);
          setMessages(conversation.messages);
        }
      } catch (cause) {
        if (!cancelled) setError(toMessage(cause));
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [remember]);

  const startNewConversation = useCallback(() => {
    remember(null);
    setMessages([]);
    setPending(null);
    setError(null);
  }, [remember]);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || isSending) return;

      setError(null);
      setIsSending(true);

      const optimisticUserMessage: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
        widgets: [],
      };

      try {
        let conversationId = activeIdRef.current;
        if (!conversationId) {
          // Conversations are created lazily so an untouched "New chat" never
          // leaves an empty thread in the sidebar.
          const created = await api.createConversation();
          conversationId = created.id;
          remember(created.id);
          setConversations((previous) => [summarize(created), ...previous]);
        }

        setMessages((previous) => [...previous, optimisticUserMessage]);
        setPending({ content: '', widgets: [], activities: [] });

        for await (const event of api.sendMessage(conversationId, trimmed)) {
          switch (event.type) {
            case 'user_message':
              setMessages((previous) =>
                previous.map((message) =>
                  message.id === optimisticUserMessage.id ? event.message : message,
                ),
              );
              break;
            case 'tool_activity':
              setPending((previous) =>
                previous
                  ? { ...previous, activities: upsertActivity(previous.activities, event.activity) }
                  : previous,
              );
              break;
            case 'text_delta':
              setPending((previous) =>
                previous ? { ...previous, content: previous.content + event.delta } : previous,
              );
              break;
            case 'widget':
              setPending((previous) =>
                previous ? { ...previous, widgets: [...previous.widgets, event.widget] } : previous,
              );
              break;
            case 'message':
              setMessages((previous) => [...previous, event.message]);
              setPending(null);
              break;
            case 'title':
              setConversations((previous) =>
                previous.map((item) =>
                  item.id === event.conversationId ? { ...item, title: event.title } : item,
                ),
              );
              break;
            case 'error':
              setError(event.message);
              break;
            case 'done':
              break;
          }
        }

        await refreshConversations();
      } catch (cause) {
        setError(toMessage(cause));
      } finally {
        setPending(null);
        setIsSending(false);
      }
    },
    [isSending, refreshConversations, remember],
  );

  const renameConversation = useCallback(async (id: string, title: string) => {
    try {
      const updated = await api.renameConversation(id, title);
      setConversations((previous) =>
        previous.map((item) => (item.id === id ? { ...item, title: updated.title } : item)),
      );
    } catch (cause) {
      setError(toMessage(cause));
    }
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await api.deleteConversation(id);
        setConversations((previous) => previous.filter((item) => item.id !== id));
        if (activeIdRef.current === id) {
          startNewConversation();
        }
      } catch (cause) {
        setError(toMessage(cause));
      }
    },
    [startNewConversation],
  );

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeId) ?? null,
    [conversations, activeId],
  );

  return {
    conversations,
    activeId,
    activeConversation,
    messages,
    pending,
    isBootstrapping,
    isLoadingConversation,
    isSending,
    error,
    dismissError: () => setError(null),
    openConversation,
    startNewConversation,
    sendMessage,
    renameConversation,
    deleteConversation,
  };
}

export type CopilotState = ReturnType<typeof useCopilot>;
