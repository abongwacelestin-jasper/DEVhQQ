/**
 * The JSONL audit file (AUDIT_LOG_FILE) as an AuditSource: streamed line by
 * line, so boot-time resume and offline verification use O(1) memory per line.
 * A missing file is an empty store; any other read error is thrown (the boot
 * then records `audit.chain_discontinuity`).
 */

import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { AuditSource, ChainHead, StoredRecord } from './chain.ts';

function isMissing(err: unknown) {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** Parsed lines of one or more JSONL files, in order. Unparseable lines are passed through as `null`. */
export async function* readJsonl(
  paths: string[],
  opts: { missingIsEmpty?: boolean } = {},
): AsyncGenerator<StoredRecord> {
  for (const path of paths) {
    // Open first so a missing or unreadable file fails here, not mid-iteration.
    let handle;
    try {
      handle = await open(path, 'r');
    } catch (err) {
      if (isMissing(err) && opts.missingIsEmpty) continue;
      throw err;
    }
    const stream = handle.createReadStream({ encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let n = 0;
    try {
      for await (const line of lines) {
        n++;
        if (!line.trim()) continue;
        let raw: unknown = null;
        try {
          raw = JSON.parse(line);
        } catch {
          raw = null;
        }
        yield { raw, position: n, ...(paths.length > 1 ? { source: path } : {}) };
      }
    } finally {
      lines.close();
      stream.destroy();
    }
  }
}

/** True when the file exists, is non-empty and its last byte is not a newline (a torn write). */
export async function endsMidLine(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return false;
  }
  try {
    const { size } = await handle.stat();
    if (!size) return false;
    const buf = Buffer.alloc(1);
    await handle.read(buf, 0, 1, size - 1);
    return buf[0] !== 0x0a;
  } catch {
    return false; // not a readable regular file: the write will fail and say so
  } finally {
    await handle.close();
  }
}

export function fileSource(path: string, expectedHead?: () => ChainHead | null): AuditSource {
  return {
    kind: 'file',
    scan: () => readJsonl([path], { missingIsEmpty: true }),
    ...(expectedHead ? { expectedHead } : {}),
  };
}
