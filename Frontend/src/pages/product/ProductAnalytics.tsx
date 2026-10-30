import { useCallback } from 'react';
import { DeliveryReliabilityCards } from '../../components/analytics/DeliveryReliabilityCards';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useProductTab } from '../../hooks/useProductTab';
import type { ProductId } from '../../types/portfolio';

export function ProductAnalytics() {
  const { product } = useProductTab();
  const { label } = useDateRange();
  const match = useCallback((p: ProductId) => p === product.id, [product.id]);
  return (
    <section aria-label={`${product.name} analytics`} className="space-y-2">
      <p className="text-[12px] text-muted">
        Delivery and reliability for <b className="font-semibold text-ink">{product.name}</b> ·{' '}
        {label}. Every figure is derived from task history, deploys, incidents and monitors — never
        entered by hand.
      </p>
      <DeliveryReliabilityCards match={match} size="large" />
    </section>
  );
}
