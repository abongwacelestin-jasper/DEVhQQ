import type { ApiDiffOp } from './useDocCollab';

/**
 * Presentation helpers for the server's line diff
 * (`GET /api/docs/:docId/versions/:versionId/diff`). The diff itself is
 * computed by the backend (`Backend/domain/collab/diff.ts`).
 */

export type DiffRow = ApiDiffOp | { op: 'gap'; n: number };

/** Collapses long unchanged runs so the view focuses on what changed. */
export function withContext(ops: ApiDiffOp[], context = 2): DiffRow[] {
  const changed = ops.map((o) => o.op !== 'equal');
  const show = ops.map((_, i) => {
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++)
      if (changed[k]) return true;
    return false;
  });
  const out: DiffRow[] = [];
  let gap = 0;
  ops.forEach((o, i) => {
    if (show[i]) {
      if (gap) out.push({ op: 'gap', n: gap });
      gap = 0;
      out.push(o);
    } else gap++;
  });
  if (gap) out.push({ op: 'gap', n: gap });
  return out;
}
