import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@shopping-copilot/shared';
import { AlertTriangleIcon, MenuIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Composer } from '@/components/composer';
import { EmptyState } from '@/components/empty-state';
import { MessageBubble } from '@/components/message-bubble';
import { ThinkingIndicator } from '@/components/thinking-indicator';
import type { PendingAssistant } from '@/hooks/use-copilot';

interface ChatViewProps {
  title: string;
  messages: ChatMessage[];
  pending: PendingAssistant | null;
  isSending: boolean;
  isLoading: boolean;
  error: string | null;
  onDismissError: () => void;
  onSend: (content: string) => void;
  onOpenSidebar: () => void;
}

export function ChatView({
  title,
  messages,
  pending,
  isSending,
  isLoading,
  error,
  onDismissError,
  onSend,
  onOpenSidebar,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether the viewport is pinned to the bottom. We only auto-scroll while
  // pinned, so a shopper who scrolled up to read earlier products isn't yanked
  // back down as tokens stream in.
  const pinnedRef = useRef(true);
  const prevMessageCount = useRef(messages.length);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    pinnedRef.current = distanceFromBottom < 64;
  };

  // Keep the newest turn in view as text and product cards stream in. We set
  // `scrollTop` directly (instant) instead of `scrollTo({ behavior: 'smooth' })`
  // because text deltas arrive far faster than a smooth scroll resolves —
  // queueing dozens of competing animations is what made the products judder.
  useEffect(() => {
    // A new persisted message means the user just sent a turn (or switched
    // conversations); re-pin so the fresh content scrolls into view.
    if (messages.length > prevMessageCount.current) {
      pinnedRef.current = true;
    }
    prevMessageCount.current = messages.length;

    const container = scrollRef.current;
    if (!container || !pinnedRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, pending?.content, pending?.widgets.length, pending?.activities.length]);

  const showEmptyState = messages.length === 0 && !pending && !isLoading;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="bg-background/80 flex items-center gap-3 border-b px-4 py-3 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={onOpenSidebar}
          aria-label="Open conversations"
        >
          <MenuIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground text-xs">
            {messages.length > 0
              ? `${messages.length} message${messages.length === 1 ? '' : 's'}`
              : 'Conversational product discovery'}
          </p>
        </div>
        <Badge variant="outline" className="text-muted-foreground hidden sm:inline-flex">
          DummyJSON catalog
        </Badge>
      </header>

      {error && (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive flex items-start gap-2 border-b px-4 py-2 text-sm"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss error">
            <XIcon className="size-4" />
          </button>
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="co-scrollbar flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {showEmptyState ? (
            <EmptyState onPick={onSend} disabled={isSending} />
          ) : (
            <>
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}

              {pending &&
                (pending.content || pending.widgets.length > 0 ? (
                  <MessageBubble
                    isStreaming
                    activities={pending.activities}
                    message={{
                      id: 'pending',
                      role: 'assistant',
                      content: pending.content,
                      createdAt: new Date().toISOString(),
                      widgets: pending.widgets,
                    }}
                  />
                ) : (
                  <ThinkingIndicator activities={pending.activities} />
                ))}
            </>
          )}
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <Composer onSend={onSend} disabled={isSending} />
      </div>
    </div>
  );
}
