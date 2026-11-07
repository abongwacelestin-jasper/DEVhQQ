/**
 * Offline audit chain verifier.
 *
 *   node --experimental-strip-types scripts/verify-audit.ts [options] <file.jsonl>...
 *   node --experimental-strip-types scripts/verify-audit.ts --database   (reads DATABASE_URL)
 *
 * Input, checked end to end as one stream in the order given:
 *   - the JSONL audit file (AUDIT_LOG_FILE), v2.0.0 or later;
 *   - a database export, one JSON row per line, oldest first:
 *       psql "$DATABASE_URL" -At -c \
 *         "SELECT row_to_json(a) FROM audit_entries a ORDER BY id" > audit-db.jsonl
 *   - archived batches from the audit bucket, in key order (header lines are skipped).
 *
 * Options:
 *   --head <hash>   the newest hash you trust from elsewhere (an archived
 *                   batch's headHash, a previous run): it must be present,
 *                   otherwise the tail was cut (`truncated_tail`).
 *   --database      verify `audit_entries` directly over DATABASE_URL (read only).
 *   --json          print the full report as JSON.
 *
 * Exit status: 0 intact · 1 broken (first break printed) · 2 intact but with
 * declared `audit.chain_discontinuity` boots to review · 64 usage · 66 input unreadable.
 */

import { ChainVerifier, type ChainReport, type StoredRecord } from '../audit/chain.ts';
import { readJsonl } from '../audit/fileSource.ts';

const args = process.argv.slice(2);
const json = args.includes('--json');
const useDb = args.includes('--database');
const headIdx = args.indexOf('--head');
const head = headIdx >= 0 ? args[headIdx + 1] : undefined;
const files = args.filter((a, i) => !a.startsWith('--') && !(headIdx >= 0 && i === headIdx + 1));

function usage(msg: string): never {
  console.error(
    `${msg}\nusage: verify-audit.ts [--head <hash>] [--json] <file.jsonl>... | --database`,
  );
  process.exit(64);
}

if (headIdx >= 0 && !/^[0-9a-f]{64}$/.test(head ?? '')) usage('--head needs a 64-hex hash');
if (useDb === files.length > 0) usage(useDb ? '--database takes no files' : 'no input given');

async function records(): Promise<{
  stream: AsyncIterable<StoredRecord>;
  close: () => Promise<void>;
}> {
  if (!useDb) return { stream: readJsonl(files), close: async () => {} };
  const url = process.env.DATABASE_URL;
  if (!url) usage('--database needs DATABASE_URL');
  const { createPool } = await import('../db/pool.ts');
  const { pgAuditSource } = await import('../db/auditSink.ts');
  const pool = createPool(url);
  return { stream: pgAuditSource(pool).scan(), close: () => pool.end() };
}

let report: ChainReport;
const input = await records();
try {
  const v = new ChainVerifier();
  for await (const rec of input.stream) v.push(rec);
  // The trusted head's seq is unknown here; the hash is what must be found.
  report = v.finish(head ? { seq: 0, hash: head } : null);
} catch (err) {
  console.error(`cannot read input: ${String((err as Error)?.message ?? err)}`);
  await input.close();
  process.exit(66);
}
await input.close();

if (json) console.log(JSON.stringify(report, null, 2));
const where = useDb ? 'row id' : 'line';
if (!report.ok) {
  const b = report.firstBreak!;
  console.error(
    `broken: ${b.reason} at ${b.position ? `${b.source ? `${b.source} ` : ''}${where} ${b.position}` : 'end of input'}` +
      `${b.seq !== null && b.seq > 0 ? ` (seq ${b.seq})` : ''}: ${b.detail}`,
  );
  process.exit(1);
}
const summary =
  `ok: ${report.entries} entries, head seq ${report.head?.seq ?? 0}` +
  (report.head ? ` (${report.head.hash.slice(0, 12)})` : '') +
  `; ${report.resumedBoots} linked boot(s), ${report.legacyBoots} v2.0.0 chain(s)` +
  (report.forks ? `; ${report.forks} fork(s)` : '') +
  (report.legacyReordered ? `; ${report.legacyReordered} v2.0.0 line(s) stored out of order` : '');
if (!json) console.log(summary);
if (report.discontinuities.length) {
  for (const d of report.discontinuities)
    console.error(
      `discontinuity at ${d.source ? `${d.source} ` : ''}${where} ${d.position} (seq ${d.seq}, ${d.at}): ${d.target}`,
    );
  process.exit(2);
}
process.exit(0);
