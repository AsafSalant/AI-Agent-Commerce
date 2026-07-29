import type { ToolActivity } from '@shopping-copilot/shared';
import { SparklesIcon } from 'lucide-react';
import { ToolActivityList } from '@/components/tool-activity-list';

interface ThinkingIndicatorProps {
  /** Catalog calls made so far this turn, e.g. "Searching the catalog for “laptop”". */
  activities: ToolActivity[];
}

export function ThinkingIndicator({ activities }: ThinkingIndicatorProps) {
  // A running call already spins its own line; the dots are for the stretch
  // where the model is composing and nothing else is moving.
  const isWorking = activities.some((activity) => activity.state === 'running');

  return (
    <div data-testid="thinking-indicator" className="flex gap-3">
      <div className="from-primary to-primary/60 flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-sm">
        <SparklesIcon className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        <ToolActivityList activities={activities} />
        {!isWorking && (
          <div className="flex items-center gap-2">
            <span className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="bg-primary size-1.5 rounded-full"
                  style={{ animation: `co-blink 1s ${dot * 0.15}s infinite ease-in-out` }}
                />
              ))}
            </span>
            <span className="text-muted-foreground text-sm">Thinking</span>
          </div>
        )}
      </div>
    </div>
  );
}
