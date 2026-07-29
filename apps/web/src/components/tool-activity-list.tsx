import type { ToolActivity, ToolActivityState, ToolTraceEntry } from '@shopping-copilot/shared';
import { CheckIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolActivityListProps {
  activities: ToolActivity[];
  className?: string;
}

/** The same checklist for a finished message, rebuilt from its stored trace. */
export function activitiesFromTrace(trace: ToolTraceEntry[] | undefined): ToolActivity[] {
  return (trace ?? []).map((entry, index) => ({
    id: `${entry.name}-${index}`,
    label: entry.label ?? entry.name.replace(/_/g, ' '),
    state: entry.error ? 'error' : 'done',
  }));
}

function ActivityIcon({ state }: { state: ToolActivityState }) {
  switch (state) {
    case 'running':
      return <LoaderCircleIcon className="text-primary size-3.5 shrink-0 animate-spin" />;
    case 'error':
      return <TriangleAlertIcon className="text-destructive size-3.5 shrink-0" />;
    default:
      return <CheckIcon className="size-3.5 shrink-0 text-[var(--success)]" />;
  }
}

/**
 * The catalog work behind an answer, one line per call. Lines appear the moment
 * a call starts and settle into a checkmark, so a slow search reads as progress
 * rather than a stalled screen.
 */
export function ToolActivityList({ activities, className }: ToolActivityListProps) {
  if (activities.length === 0) return null;

  return (
    <ul
      data-testid="tool-activity-list"
      aria-live="polite"
      className={cn('flex flex-col gap-1', className)}
    >
      {activities.map((activity) => (
        <li
          key={activity.id}
          data-state={activity.state}
          className="co-rise text-muted-foreground flex items-center gap-2 text-xs"
        >
          <ActivityIcon state={activity.state} />
          <span className="min-w-0">{activity.label}</span>
        </li>
      ))}
    </ul>
  );
}
