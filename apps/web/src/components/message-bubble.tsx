import type { ChatMessage, MessageWidget, ToolActivity } from '@shopping-copilot/shared';
import { SparklesIcon, UserIcon } from 'lucide-react';
import { ProductListWidget } from '@/components/product-list-widget';
import { activitiesFromTrace, ToolActivityList } from '@/components/tool-activity-list';
import { ToolTrace } from '@/components/tool-trace';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: ChatMessage;
  /** Assistant turn still streaming: content grows and widgets stream in. */
  isStreaming?: boolean;
  /**
   * The live checklist of catalog calls. Only the streaming turn has one; a
   * persisted message rebuilds the same lines from its stored trace.
   */
  activities?: ToolActivity[];
}

function renderWidget(widget: MessageWidget) {
  switch (widget.type) {
    case 'product_list':
      return <ProductListWidget key={widget.id} widget={widget} />;
    default:
      return null;
  }
}

export function MessageBubble({ message, isStreaming = false, activities }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const steps = activities ?? activitiesFromTrace(message.toolTrace);

  return (
    <article
      data-testid={`message-${message.role}`}
      className={cn('co-rise flex gap-3', isUser ? 'justify-end' : 'justify-start')}
    >
      {!isUser && (
        <div className="from-primary to-primary/60 flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-sm">
          <SparklesIcon className="size-4" />
        </div>
      )}

      <div className={cn('min-w-0', isUser ? 'max-w-[85%]' : 'flex-1')}>
        {isUser ? (
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
            {message.content}
          </div>
        ) : (
          <>
            <ToolActivityList activities={steps} className="mb-2" />
            {message.content && (
              <div data-testid="message-text" className="text-sm leading-relaxed whitespace-pre-wrap">
                {message.content}
                {isStreaming && (
                  <span className="bg-primary ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm" />
                )}
              </div>
            )}
            {message.widgets.map(renderWidget)}
            {message.toolTrace && <ToolTrace trace={message.toolTrace} />}
          </>
        )}
      </div>

      {isUser && (
        <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
          <UserIcon className="size-4" />
        </div>
      )}
    </article>
  );
}
