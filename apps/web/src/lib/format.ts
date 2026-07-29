const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export function formatPrice(value: number): string {
  return currency.format(value);
}

export function formatRelativeTime(isoDate: string): string {
  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) return '';

  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function titleCaseSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Turns applied search filters into short human-readable chips. */
export function describeFilters(filters: Record<string, unknown>): string[] {
  const chips: string[] = [];
  const value = (key: string) => filters[key];

  if (typeof value('category') === 'string') chips.push(titleCaseSlug(value('category') as string));
  if (typeof value('brand') === 'string') chips.push(`Brand: ${value('brand')}`);
  if (typeof value('minPrice') === 'number') chips.push(`Over ${formatPrice(value('minPrice') as number)}`);
  if (typeof value('maxPrice') === 'number') chips.push(`Under ${formatPrice(value('maxPrice') as number)}`);
  if (typeof value('minRating') === 'number') chips.push(`${value('minRating')}★ and up`);
  if (value('inStockOnly') === true) chips.push('In stock');

  const sortBy = value('sortBy');
  if (sortBy === 'price') chips.push(value('order') === 'desc' ? 'Priciest first' : 'Cheapest first');
  if (sortBy === 'rating') chips.push('Top rated');
  if (sortBy === 'discount') chips.push('Biggest discount');

  return chips;
}
