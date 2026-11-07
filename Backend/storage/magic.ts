/**
 * Content sniffing by magic bytes. The declared Content-Type is client input;
 * `complete` only accepts an upload whose first bytes match it.
 */

/** Bytes read from the start of an object for sniffing. */
export const SNIFF_BYTES = 512;

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((x, i) => b[offset + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Text types have no magic number: require valid UTF-8, no NULs, and nothing HTML-like. */
function looksLikeSafeText(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  // Trim a possibly split trailing multi-byte sequence before validating.
  let end = b.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const c = b[end - i];
    if ((c & 0xc0) === 0xc0) {
      end -= i;
      break;
    }
    if ((c & 0x80) === 0) break;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, end));
    // Browsers sniff these as HTML/SVG/XML in some contexts — refuse even as attachments.
    // Covers every WHATWG MIME Sniffing HTML pattern (§7.1); short tags need a
    // tag-terminating space or '>' as in the spec (FINDING B-20).
    return !/^\s*(<!--|<\?xml|<(!doctype|html|svg|script|head|body|iframe)|<(a|b|br|p|h1|div|font|table|style|title)[\s>])/i.test(
      text,
    );
  } catch {
    return false;
  }
}

const sniffers: Record<string, (b: Uint8Array) => boolean> = {
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/gif': (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')),
  'image/webp': (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  'application/pdf': (b) => startsWith(b, ascii('%PDF-')),
  'application/zip': (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  // OOXML documents are ZIP containers.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) =>
    startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) =>
    startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': (b) =>
    startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  'text/plain': looksLikeSafeText,
  'text/markdown': looksLikeSafeText,
  'text/csv': looksLikeSafeText,
  'application/json': (b) =>
    looksLikeSafeText(b) && /^\s*[[{"]/.test(Buffer.from(b).toString('utf8')),
};

/** True when `bytes` (the start of the object) is consistent with `contentType`. */
export function matchesMagic(contentType: string, bytes: Uint8Array): boolean {
  const check = sniffers[contentType];
  return !!check && bytes.length > 0 && check(bytes);
}

export const sniffableTypes = Object.keys(sniffers);
