import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Filters stored in the URL query string so filtered views are shareable. */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const keyList = keys.join('|');

  const values = useMemo(
    () =>
      Object.fromEntries(keyList.split('|').map((k) => [k, params.get(k) ?? ''])) as Record<
        K,
        string
      >,
    [params, keyList],
  );

  const setMany = useCallback(
    (patch: Partial<Record<K, string>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          (Object.keys(patch) as K[]).forEach((k) => {
            const v = patch[k];
            if (v) next.set(k, v);
            else next.delete(k);
          });
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const set = useCallback(
    (k: K, v: string) => setMany({ [k]: v } as Partial<Record<K, string>>),
    [setMany],
  );

  const reset = useCallback(() => {
    setMany(
      Object.fromEntries(keyList.split('|').map((k) => [k, ''])) as Partial<Record<K, string>>,
    );
  }, [setMany, keyList]);

  const activeCount = keyList.split('|').filter((k) => values[k as K]).length;

  return { values, set, setMany, reset, activeCount };
}
