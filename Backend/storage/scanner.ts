/**
 * Malware-scan hook. `complete` calls the active scanner before a file
 * becomes downloadable; an `infected` verdict deletes the object and rejects
 * the upload.
 *
 * Default: a no-op scanner that reports `skipped` (recorded on the file row so
 * nothing claims a scan that never happened).
 *
 * ClamAV: run `clamav/clamav` as an internal-only service and implement
 * `scan` with clamd's INSTREAM command over TCP 3310 — send `zINSTREAM\0`,
 * then the object as <4-byte big-endian length><chunk> frames, then a zero
 * length frame; the reply is `stream: OK` or `stream: <Signature> FOUND`.
 * Stream the object from `read()` (it returns the whole object, ≤ 25 MB here)
 * and fail closed (`error`) on timeouts. Register it at boot with
 * `setMalwareScanner(clamavScanner)`.
 */

export type ScanVerdict = 'clean' | 'infected' | 'skipped' | 'error';

export interface ScanInput {
  bucket: string;
  key: string;
  size: number;
  contentType: string;
  read: () => Promise<Buffer>;
}

export interface MalwareScanner {
  readonly name: string;
  scan(input: ScanInput): Promise<{ verdict: ScanVerdict; signature?: string }>;
}

export const noopScanner: MalwareScanner = {
  name: 'none',
  scan: async () => ({ verdict: 'skipped' }),
};

let active: MalwareScanner = noopScanner;

export function setMalwareScanner(next: MalwareScanner) {
  active = next;
}

export function malwareScanner(): MalwareScanner {
  return active;
}
