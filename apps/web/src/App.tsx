import { useState } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatView } from '@/components/chat-view';
import { ConversationSidebar } from '@/components/conversation-sidebar';
import { useCopilot } from '@/hooks/use-copilot';
import { cn } from '@/lib/utils';

export default function App() {
  const copilot = useCopilot();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // A single sidebar instance is repositioned by viewport: static beside the
  // chat on desktop, a slide-over drawer on mobile. Rendering it twice would
  // duplicate every conversation control in the accessibility tree.
  const sidebar = (
    <ConversationSidebar
      conversations={copilot.conversations}
      activeId={copilot.activeId}
      isLoading={copilot.isBootstrapping}
      onNewConversation={() => {
        copilot.startNewConversation();
        setIsSidebarOpen(false);
      }}
      onSelect={(id) => {
        void copilot.openConversation(id);
        setIsSidebarOpen(false);
      }}
      onRename={(id, title) => void copilot.renameConversation(id, title)}
      onDelete={(id) => void copilot.deleteConversation(id)}
    />
  );

  return (
    <div className="bg-background flex h-full">
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/50 transition-opacity md:hidden',
          isSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setIsSidebarOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={cn(
          'bg-background fixed inset-y-0 left-0 z-40 w-72 shrink-0 border-r shadow-xl transition-transform md:static md:z-auto md:translate-x-0 md:shadow-none',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-2 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-label="Close conversations"
        >
          <XIcon />
        </Button>
        {sidebar}
      </aside>

      <main className="flex min-w-0 flex-1">
        <ChatView
          title={copilot.activeConversation?.title ?? 'New conversation'}
          messages={copilot.messages}
          pending={copilot.pending}
          isSending={copilot.isSending}
          isLoading={copilot.isBootstrapping || copilot.isLoadingConversation}
          error={copilot.error}
          onDismissError={copilot.dismissError}
          onSend={(content) => void copilot.sendMessage(content)}
          onOpenSidebar={() => setIsSidebarOpen(true)}
        />
      </main>
    </div>
  );
}
