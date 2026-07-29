import type { Product } from '@shopping-copilot/shared';
import { ArrowUpRightIcon, PackageIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RatingStars } from '@/components/rating-stars';
import { formatPrice, titleCaseSlug } from '@/lib/format';

interface ProductCardProps {
  product: Product;
  onOpenDetails: (product: Product) => void;
}

const LOW_STOCK_THRESHOLD = 10;

export function ProductCard({ product, onOpenDetails }: ProductCardProps) {
  const hasDiscount = product.discountPercentage >= 1;
  const isOutOfStock = product.stock <= 0;

  return (
    <Card
      data-testid="product-card"
      data-product-id={product.id}
      className="group h-full overflow-hidden transition-all hover:shadow-md"
    >
      <div className="bg-muted/40 relative flex h-36 items-center justify-center overflow-hidden">
        <img
          src={product.thumbnail}
          alt={product.title}
          loading="lazy"
          className="h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-105"
        />
        {hasDiscount && (
          <Badge className="absolute top-2 left-2 bg-[var(--success)] text-white">
            -{Math.round(product.discountPercentage)}%
          </Badge>
        )}
        {isOutOfStock ? (
          <Badge variant="destructive" className="absolute top-2 right-2">
            Out of stock
          </Badge>
        ) : product.stock <= LOW_STOCK_THRESHOLD ? (
          <Badge variant="secondary" className="absolute top-2 right-2">
            Only {product.stock} left
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-muted-foreground border-border/70">
            {titleCaseSlug(product.category)}
          </Badge>
          {product.brand && (
            <span className="text-muted-foreground truncate text-xs">{product.brand}</span>
          )}
        </div>

        <h4 className="line-clamp-2 text-sm leading-snug font-semibold" title={product.title}>
          {product.title}
        </h4>

        <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
          {product.description}
        </p>

        <RatingStars rating={product.rating} reviewCount={product.reviewCount} />

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="flex flex-col">
            <span className="text-base leading-tight font-semibold">
              {formatPrice(product.finalPrice)}
            </span>
            {hasDiscount && (
              <span className="text-muted-foreground/80 text-xs line-through">
                {formatPrice(product.price)}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onOpenDetails(product)}
            aria-label={`View details for ${product.title}`}
          >
            Details
            <ArrowUpRightIcon />
          </Button>
        </div>

        {product.availabilityStatus && !isOutOfStock && (
          <div className="text-muted-foreground/80 flex items-center gap-1 text-[11px]">
            <PackageIcon className="size-3" />
            {product.availabilityStatus}
          </div>
        )}
      </div>
    </Card>
  );
}
