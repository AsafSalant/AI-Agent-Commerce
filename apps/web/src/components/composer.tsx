import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUpIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ComposerProps {
  onSend: (content: string) => void;
  disabled: boolean;
}

const MAX_LENGTH = 2000;

export function Composer({ onSend, disabled }: ComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    textareaRef.current?.focus();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={disabled}
      data-testid="composer"
      className="mx-auto w-full max-w-3xl"
    >
      <div className="bg-card focus-within:border-primary/50 focus-within:shadow-sm flex items-end gap-2 rounded-2xl border p-2 shadow-sm transition-colors">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={handleKeyDown}
          placeholder="Ask for anything — “wireless earbuds under $50”, “a gift for a coffee lover”…"
          aria-label="Message the shopping agent"
          rows={1}
          className="max-h-40 min-h-10 flex-1 py-2"
        />
        <Button
          type="submit"
          size="icon"
          disabled={disabled || value.trim().length === 0}
          aria-label="Send message"
          className="rounded-xl"
        >
          {disabled ? <LoaderCircleIcon className="animate-spin" /> : <ArrowUpIcon />}
        </Button>
      </div>
      <p className="text-muted-foreground/70 mt-1.5 text-center text-xs">
        Enter to send · Shift + Enter for a new line · Results come from the DummyJSON catalog
      </p>
    </form>
  );
}
