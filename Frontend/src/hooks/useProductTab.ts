import { useOutletContext } from 'react-router-dom';
import type { Product } from '../types/portfolio';

export interface ProductTabContext {
  product: Product;
  filters: { q: string; person: string; priority: string; status: string };
}

/** Shared state every product tab receives from the product layout. */
export function useProductTab() {
  return useOutletContext<ProductTabContext>();
}

export function textMatch(q: string, ...fields: (string | number | undefined)[]) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => f !== undefined && String(f).toLowerCase().includes(needle));
}
