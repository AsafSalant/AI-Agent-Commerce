import { StarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RatingStarsProps {
  rating: number;
  reviewCount?: number;
  className?: string;
}

export function RatingStars({ rating, reviewCount, className }: RatingStarsProps) {
  const rounded = Math.round(rating);

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      aria-label={`Rated ${rating} out of 5`}
      title={`Rated ${rating} out of 5`}
    >
      <div className="flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => (
          <StarIcon
            key={star}
            className={cn(
              'size-3',
              star <= rounded ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
            )}
          />
        ))}
      </div>
      <span className="text-muted-foreground text-xs font-medium">{rating.toFixed(2)}</span>
      {reviewCount ? (
        <span className="text-muted-foreground/70 text-xs">({reviewCount})</span>
      ) : null}
    </div>
  );
}
