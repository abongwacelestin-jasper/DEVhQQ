import { useLayoutEffect, useState } from 'react';

/** Shows a brief loading state whenever `key` changes (route or product scope), simulating data fetching. */
export function useRouteLoading(key: string, ms = 420) {
  const [loading, setLoading] = useState(true);
  useLayoutEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return loading;
}
