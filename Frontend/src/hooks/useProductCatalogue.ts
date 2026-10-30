import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ApiProductSummary } from '../api/types';
import { useAuth } from '../contexts/AuthContext';

/**
 * Product names and live counts, scoped to the signed-in caller.
 *
 * Pages that only need a display name should not pull the whole product
 * fixture file — the API already knows which products this account can see.
 */
export function useProductCatalogue() {
  const { session } = useAuth();
  const memberId = session?.memberId ?? null;
  const [products, setProducts] = useState<ApiProductSummary[]>([]);

  useEffect(() => {
    if (!memberId) {
      setProducts([]);
      return;
    }
    let alive = true;
    api<ApiProductSummary[]>('/api/products')
      .then((rows) => {
        if (alive) setProducts(rows);
      })
      .catch(() => {
        /* Pages fall back to the product id when a name is missing. */
      });
    return () => {
      alive = false;
    };
  }, [memberId]);

  return products;
}
