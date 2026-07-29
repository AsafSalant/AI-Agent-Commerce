import { SparklesIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface EmptyStateProps {
  onPick: (prompt: string) => void;
  disabled: boolean;
}

const SUGGESTIONS = [
  {
    title: 'A laptop for work',
    prompt: 'I need a reliable laptop for work under $1500',
  },
  {
    title: 'Gift for a coffee lover',
    prompt: 'Looking for a gift for someone who loves coffee, around $40',
  },
  {
    title: 'Best rated smartphones',
    prompt: 'Show me the best rated smartphones you have',
  },
  {
    title: "Today's biggest discounts",
    prompt: 'What are the biggest discounts in the store right now?',
  },
];

export function EmptyState({ onPick, disabled }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-12 text-center">
      <div className="from-primary to-primary/60 mb-5 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm">
        <SparklesIcon className="size-6" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">What are you shopping for?</h2>
      <p className="text-muted-foreground mt-2 max-w-md text-sm leading-relaxed">
        Describe what you need in your own words. I&apos;ll search the catalog and show you matching
        products right here in the chat.
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <Card key={suggestion.title} className="overflow-hidden">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(suggestion.prompt)}
              className="hover:bg-accent/50 flex h-full w-full cursor-pointer flex-col p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="block text-sm font-medium">{suggestion.title}</span>
              <span className="text-muted-foreground mt-0.5 block text-xs">
                “{suggestion.prompt}”
              </span>
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}
