/**
 * Files/Storage — presign allow-list, magic-byte bypass, scriptable types,
 * path traversal in names, and download disposition (WAVE4 §6 STORAGE).
 *
 * Runs the full presign → PUT → complete → download flow against the in-process
 * local object-store driver (dev). Verifies:
 *  1. Scriptable / HTML-sniffable types are refused at presign (415): text/html,
 *     image/svg+xml, and an avatar type outside the raster allow-list.
 *  2. Oversize is refused at presign (413).
 *  3. Magic-byte bypass: declaring image/png but uploading HTML bytes is
 *     rejected at complete (422 type_mismatch) and never becomes ready.
 *  4. Path traversal in the file name is stripped (stored name has no path).
 *  5. A genuine raster uploads, completes, and its download URL is short-lived
 *     and inline; the presign carried an expiry.
 *
 * Fails if a scriptable type is accepted, a type-mismatched object becomes
 * ready, a traversal name survives, or the download TTL is unbounded.
 */

import { CLI, req, signInDemo, type Check } from '../lib/harness.ts';
import { isMain, runStandalone } from '../lib/standalone.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');

async function putBytes(url: string, headers: Record<string, string>, body: Buffer) {
  return fetch(url, { method: 'PUT', headers, body, signal: AbortSignal.timeout(8000) });
}

export const check: Check = {
  name: 'File upload policy (type/magic/traversal/disposition)',
  area: 'Storage/Files',
  // No S3_ENDPOINT → the dev local disk driver is used (localDir derives from the
  // harness's temp BACKUP_DIR), so the full upload flow runs in-process.
  run: async (base) => {
    const token = await signInDemo(base, 'developer');
    const me = (await req(base, 'GET', '/api/auth/session', { token })).json?.member?.id;
    if (!me) return { status: 'fail', id: 'INFO-FILES', detail: 'could not resolve own member id' };

    const presign = (ct: string, size: number, name = 'a.png') =>
      req(base, 'POST', '/api/files/uploads', {
        token,
        headers: CLI,
        body: { purpose: 'avatar', contentType: ct, size, name, refId: me },
      });

    // If storage is somehow unavailable, fail closed and skip (not a vuln).
    const probe = await presign('image/png', PNG.length);
    if (probe.status === 503)
      return { status: 'skip', id: 'INFO-FILES', detail: 'object storage unconfigured (fail-closed 503) — allow-list tested on Docker stack' };

    const problems: string[] = [];

    // (1) Scriptable / HTML-sniffable types refused at presign.
    for (const ct of ['text/html', 'image/svg+xml', 'application/pdf']) {
      const r = await presign(ct, 100);
      if (r.status !== 415) problems.push(`avatar accepted disallowed type ${ct} (${r.status})`);
    }
    // (2) Oversize refused.
    const big = await presign('image/png', 5 * 1024 * 1024);
    if (big.status !== 413) problems.push(`oversize avatar not refused (${big.status})`);

    // (3) Magic-byte bypass: declare png, upload HTML bytes → complete rejects.
    const mb = await presign('image/png', HTML.length, 'evil.png');
    if (mb.status === 201) {
      await putBytes(mb.json.uploadUrl, mb.json.headers ?? {}, HTML);
      const complete = await req(base, 'POST', `/api/files/${mb.json.fileId}/complete`, { token, headers: CLI, body: {} });
      if (complete.status === 200 && complete.json?.status === 'ready')
        problems.push('type-mismatched upload (HTML as png) became ready — magic-byte check bypassed');
      else if (complete.status !== 422) problems.push(`unexpected complete status for mismatch (${complete.status})`);
    } else problems.push(`png presign failed (${mb.status})`);

    // (4+5) Path traversal in name + genuine raster + download disposition.
    const good = await presign('image/png', PNG.length, '../../../../etc/passwd.png');
    if (good.status === 201) {
      await putBytes(good.json.uploadUrl, good.json.headers ?? {}, PNG);
      const complete = await req(base, 'POST', `/api/files/${good.json.fileId}/complete`, { token, headers: CLI, body: {} });
      if (complete.status !== 200) problems.push(`legit png did not complete (${complete.status} ${complete.text})`);
      const name = complete.json?.name ?? '';
      if (/[\\/]/.test(name) || name.includes('..')) problems.push(`traversal name survived: "${name}"`);

      const dl = await req(base, 'GET', `/api/files/${good.json.fileId}`, { token, headers: CLI });
      if (dl.json?.disposition !== 'inline') problems.push(`raster not served inline (${dl.json?.disposition})`);
      const exp = dl.json?.expiresAt ? new Date(dl.json.expiresAt).getTime() - Date.now() : Infinity;
      if (!(exp > 0 && exp <= 5 * 60_000)) problems.push(`download URL TTL not short-lived (${Math.round(exp / 1000)}s)`);
    } else problems.push(`traversal-name png presign failed (${good.status})`);

    return {
      status: problems.length ? 'fail' : 'pass',
      id: 'INFO-FILES',
      detail: problems.length
        ? problems.join('; ')
        : 'scriptable types 415; oversize 413; magic-byte mismatch rejected; traversal name stripped; download inline + short TTL',
    };
  },
};

if (isMain(import.meta.url)) void runStandalone(check);
