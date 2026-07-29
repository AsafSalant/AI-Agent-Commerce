import { useState } from 'react';
import type { ConversationSummary } from '@shopping-copilot/shared';
import {
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  isLoading: boolean;
  onNewConversation: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function ConversationSidebar({
  conversations,
  activeId,
  isLoading,
  onNewConversation,
  onSelect,
  onRename,
  onDelete,
}: ConversationSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const commitRename = () => {
    if (renamingId && draftTitle.trim()) {
      onRename(renamingId, draftTitle.trim());
    }
    setRenamingId(null);
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2 px-1 pt-1">
        <div className="from-primary to-primary/60 flex size-8 items-center justify-center rounded-lg bg-gradient-to-br text-base font-bold text-white shadow-sm">
          S
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">Shopper</p>
          <p className="text-muted-foreground truncate text-xs">Shopping agent</p>
        </div>
      </div>

      <Button onClick={onNewConversation} className="w-full justify-start">
        <MessageSquarePlusIcon />
        New conversation
      </Button>

      <nav aria-label="Past conversations" className="co-scrollbar -mr-1 flex-1 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-14 w-full" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">
            No conversations yet. Ask for a product to get started.
          </p>
        ) : (
          <ul className="space-y-1">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeId;
              return (
                <li key={conversation.id} className="group/item relative">
                  {renamingId === conversation.id ? (
                    <input
                      autoFocus
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename();
                        if (event.key === 'Escape') setRenamingId(null);
                      }}
                      aria-label="Conversation title"
                      className="border-primary bg-card w-full rounded-lg border px-2.5 py-2 text-sm outline-none"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onSelect(conversation.id)}
                        aria-current={isActive}
                        className={cn(
                          'w-full rounded-lg px-2.5 py-2 pr-9 text-left transition-colors',
                          isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70',
                        )}
                      >
                        <span className="block truncate text-sm font-medium">
                          {conversation.title}
                        </span>
                        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                          <span className="truncate">
                            {conversation.lastMessagePreview || 'Empty conversation'}
                          </span>
                        </span>
                        <span className="text-muted-foreground/70 text-[11px]">
                          {formatRelativeTime(conversation.updatedAt)} · {conversation.messageCount}{' '}
                          messages
                        </span>
                      </button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Options for ${conversation.title}`}
                            className="absolute top-1.5 right-1 opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                          >
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              setRenamingId(conversation.id);
                              setDraftTitle(conversation.title);
                            }}
                          >
                            <PencilIcon />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => onDelete(conversation.id)}
                          >
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );
}
