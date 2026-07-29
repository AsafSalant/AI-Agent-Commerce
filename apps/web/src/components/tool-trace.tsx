import type { ToolTraceEntry } from '@shopping-copilot/shared';
import { ChevronDownIcon, WrenchIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface ToolTraceProps {
  trace: ToolTraceEntry[];
}

/** Shows which catalog calls produced an answer — handy for demos and debugging. */
export function ToolTrace({ trace }: ToolTraceProps) {
  if (trace.length === 0) return null;

  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1.5 text-xs transition-colors">
        <WrenchIcon className="size-3" />
        {trace.length === 1 ? '1 catalog lookup' : `${trace.length} catalog lookups`}
        <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="text-muted-foreground mt-2 space-y-1.5 text-xs">
          {trace.map((entry, index) => (
            <li key={`${entry.name}-${index}`} className="bg-muted/40 rounded-md px-2.5 py-1.5">
              <span className="text-foreground font-medium">{entry.name}</span>
              <span className="ml-1.5">
                {entry.resultCount} result{entry.resultCount === 1 ? '' : 's'} · {entry.durationMs}ms
              </span>
              {entry.error && <span className="text-destructive ml-1.5">{entry.error}</span>}
              <pre className="mt-1 overflow-x-auto text-[11px] whitespace-pre-wrap opacity-80">
                {JSON.stringify(entry.args)}
              </pre>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
