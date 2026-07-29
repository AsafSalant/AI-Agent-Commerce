import { useEffect, useState } from 'react';
import type { Product } from '@shopping-copilot/shared';
import { RotateCcwIcon, ShieldCheckIcon, TruckIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { RatingStars } from '@/components/rating-stars';
import { formatPrice, titleCaseSlug } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ProductDetailsDialogProps {
  product: Product | null;
  onClose: () => void;
}

export function ProductDetailsDialog({ product, onClose }: ProductDetailsDialogProps) {
  const [activeImage, setActiveImage] = useState(0);

  useEffect(() => {
    setActiveImage(0);
  }, [product?.id]);

  if (!product) return null;

  const gallery = product.images.length > 0 ? product.images : [product.thumbnail];
  const hasDiscount = product.discountPercentage >= 1;

  return (
    <Dialog open={Boolean(product)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto co-scrollbar">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{titleCaseSlug(product.category)}</Badge>
            {product.brand && <Badge variant="outline">{product.brand}</Badge>}
            {product.sku && (
              <span className="text-muted-foreground text-xs">SKU {product.sku}</span>
            )}
          </div>
          <DialogTitle className="pr-8">{product.title}</DialogTitle>
          <DialogDescription>{product.description}</DialogDescription>
        </DialogHeader>

        <div className="bg-muted/60 flex h-56 items-center justify-center overflow-hidden rounded-lg">
          <img
            src={gallery[activeImage]}
            alt={product.title}
            className="h-full w-full object-contain p-3"
          />
        </div>

        {gallery.length > 1 && (
          <div className="flex gap-2">
            {gallery.map((image, index) => (
              <button
                key={image}
                type="button"
                onClick={() => setActiveImage(index)}
                aria-label={`Show image ${index + 1}`}
                aria-current={index === activeImage}
                className={cn(
                  'bg-muted/60 size-14 overflow-hidden rounded-md border transition-colors',
                  index === activeImage ? 'border-primary' : 'border-border hover:border-primary/50',
                )}
              >
                <img src={image} alt="" className="h-full w-full object-contain p-1" />
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{formatPrice(product.finalPrice)}</span>
            {hasDiscount && (
              <>
                <span className="text-muted-foreground text-sm line-through">
                  {formatPrice(product.price)}
                </span>
                <Badge className="bg-[var(--success)] text-white">
                  Save {Math.round(product.discountPercentage)}%
                </Badge>
              </>
            )}
          </div>
          <RatingStars rating={product.rating} reviewCount={product.reviewCount} />
        </div>

        <Separator />

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Detail
            icon={<TruckIcon className="size-4" />}
            label="Shipping"
            value={product.shippingInformation ?? 'Standard shipping'}
          />
          <Detail
            icon={<ShieldCheckIcon className="size-4" />}
            label="Warranty"
            value={product.warrantyInformation ?? 'Not specified'}
          />
          <Detail
            icon={<RotateCcwIcon className="size-4" />}
            label="Returns"
            value={product.returnPolicy ?? 'Not specified'}
          />
          <Detail
            label="Availability"
            value={
              product.stock > 0
                ? `${product.availabilityStatus ?? 'In stock'} · ${product.stock} units`
                : 'Out of stock'
            }
          />
        </dl>

        {product.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {product.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-muted-foreground">
                #{tag}
              </Badge>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-muted/40 flex items-start gap-2 rounded-md p-2.5">
      {icon && <span className="text-muted-foreground mt-0.5">{icon}</span>}
      <div>
        <dt className="text-muted-foreground text-xs">{label}</dt>
        <dd className="font-medium">{value}</dd>
      </div>
    </div>
  );
}
