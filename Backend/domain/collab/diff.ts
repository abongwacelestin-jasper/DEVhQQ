/**
 * Line diff (LCS) for doc versions. Bodies are capped at 200 kB by the docs
 * routes; above MAX_CELLS the diff degrades to "replace everything" instead of
 * spending quadratic memory.
 */

export type DiffOp = { op: 'equal' | 'add' | 'remove'; line: string };

const MAX_CELLS = 4_000_000;

export function lineDiff(a: string, b: string): { ops: DiffOp[]; added: number; removed: number } {
  const x = a.split('\n');
  const y = b.split('\n');
  // Trim the common prefix/suffix first — most edits are local.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const midX = x.slice(start, endX);
  const midY = y.slice(start, endY);
  const ops: DiffOp[] = x.slice(0, start).map((line) => ({ op: 'equal', line }));

  if (midX.length * midY.length > MAX_CELLS) {
    for (const line of midX) ops.push({ op: 'remove', line });
    for (const line of midY) ops.push({ op: 'add', line });
  } else {
    const n = midX.length;
    const m = midY.length;
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i][j] =
          midX[i] === midY[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midX[i] === midY[j]) {
        ops.push({ op: 'equal', line: midX[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ op: 'remove', line: midX[i++] });
      else ops.push({ op: 'add', line: midY[j++] });
    }
    while (i < n) ops.push({ op: 'remove', line: midX[i++] });
    while (j < m) ops.push({ op: 'add', line: midY[j++] });
  }
  for (const line of x.slice(endX)) ops.push({ op: 'equal', line });
  return {
    ops,
    added: ops.filter((o) => o.op === 'add').length,
    removed: ops.filter((o) => o.op === 'remove').length,
  };
}
