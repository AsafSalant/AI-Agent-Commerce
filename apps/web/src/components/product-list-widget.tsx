import { useState } from 'react';
import type { Product, ProductListWidget as ProductListWidgetData } from '@shopping-copilot/shared';
import { SparklesIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ProductCard } from '@/components/product-card';
import { ProductDetailsDialog } from '@/components/product-details-dialog';
import { describeFilters } from '@/lib/format';

interface ProductListWidgetProps {
  widget: ProductListWidgetData;
}

/**
 * The in-chat product widget: results are rendered as cards rather than text so
 * the shopper can scan images, prices and ratings directly in the conversation.
 */
export function ProductListWidget({ widget }: ProductListWidgetProps) {
  const [selected, setSelected] = useState<Product | null>(null);
  const chips = describeFilters(widget.filters as unknown as Record<string, unknown>);
  const hiddenCount = Math.max(0, widget.total - widget.products.length);

  return (
    <section
      data-testid="product-list-widget"
      aria-label={`Product results: ${widget.heading}`}
      className="bg-card/60 mt-3 rounded-xl border p-3"
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SparklesIcon className="text-primary size-4" />
          <h3 className="text-sm font-semibold tracking-tight">{widget.heading}</h3>
        </div>
        <span className="text-muted-foreground text-xs">
          {widget.products.length} shown
          {hiddenCount > 0 ? ` · ${hiddenCount} more match` : ''}
        </span>
      </header>

      {chips.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Badge key={chip} variant="secondary" className="font-normal">
              {chip}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {widget.products.map((product, index) => (
          <div
            key={product.id}
            className="co-rise h-full"
            style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
          >
            <ProductCard product={product} onOpenDetails={setSelected} />
          </div>
        ))}
      </div>

      <ProductDetailsDialog product={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
