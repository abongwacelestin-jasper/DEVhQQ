import { useCallback, useRef, useState } from 'react';
import { api } from '../../api/client';
import { errorMessage, isUnavailable } from './apiState';

/**
 * Local adapter for the STORAGE upload contract (WAVE4 §6).
 *
 * STORAGE owns `hooks/useUpload.ts` + `components/ui/FileUpload.tsx`; they are
 * not on this branch yet, so this adapter speaks the same contract and can be
 * swapped for `useUpload` once the lanes merge:
 *
 *   POST /api/files/uploads {purpose, contentType, size, name, refId}
 *     → {fileId, uploadUrl, headers, expiresAt}       (presigned PUT)
 *   PUT  uploadUrl (headers)                          (direct to object storage)
 *   POST /api/files/:fileId/complete                  (server verifies size/type/magic bytes)
 *   GET  /api/files/:fileId → {url, expiresAt}        (short-lived presigned GET)
 */

export type UploadPurpose = 'doc-attachment' | 'avatar' | 'message-attachment';

export interface UploadTicket {
  fileId: string;
  uploadUrl: string;
  headers?: Record<string, string>;
  expiresAt: string;
}

export interface UploadedFile {
  fileId: string;
  name: string;
  size: number;
  contentType: string;
}

export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; name: string; progress: number }
  | { status: 'done'; file: UploadedFile }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

/** Client-side guard only; the server's allow-list is the authority. */
export const MAX_UPLOAD_BYTES = 25_000_000;
const BLOCKED = /\.(exe|bat|cmd|sh|ps1|msi|dll|scr|com|jar)$/i;

export function precheck(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return 'Files over 25 MB are blocked.';
  if (BLOCKED.test(file.name)) return 'Executable files are blocked for security.';
  return null;
}

function put(
  ticket: UploadTicket,
  file: File,
  onProgress: (p: number) => void,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.uploadUrl);
    Object.entries(ticket.headers ?? {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage rejected the upload (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error("Couldn't reach object storage."));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export function useFileUpload(purpose: UploadPurpose) {
  const [state, setState] = useState<UploadState>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const upload = useCallback(
    async (file: File, refId?: string): Promise<UploadedFile | null> => {
      const blocked = precheck(file);
      if (blocked) {
        setState({ status: 'error', message: blocked });
        return null;
      }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const contentType = file.type || 'application/octet-stream';
      setState({ status: 'uploading', name: file.name, progress: 0 });
      try {
        const ticket = await api<UploadTicket>('/api/files/uploads', {
          method: 'POST',
          body: { purpose, contentType, size: file.size, name: file.name, refId },
          signal: ctrl.signal,
        });
        await put(
          ticket,
          file,
          (progress) => setState({ status: 'uploading', name: file.name, progress }),
          ctrl.signal,
        );
        await api(`/api/files/${encodeURIComponent(ticket.fileId)}/complete`, {
          method: 'POST',
          signal: ctrl.signal,
        });
        const done: UploadedFile = {
          fileId: ticket.fileId,
          name: file.name,
          size: file.size,
          contentType,
        };
        setState({ status: 'done', file: done });
        return done;
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          setState({ status: 'idle' });
          return null;
        }
        setState(
          isUnavailable(e)
            ? {
                status: 'unavailable',
                message: 'File storage is not configured on this server (STORAGE / S3).',
              }
            : { status: 'error', message: errorMessage(e, 'The upload failed.') },
        );
        return null;
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [purpose],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => setState({ status: 'idle' }), []);
  return { state, upload, cancel, reset };
}

/** Resolves a short-lived download URL for a stored file. */
export async function fileUrl(fileId: string): Promise<string> {
  const res = await api<{ url: string; expiresAt?: string }>(
    `/api/files/${encodeURIComponent(fileId)}`,
  );
  return res.url;
}

export function formatBytes(b: number) {
  if (b > 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  if (b > 1000) return `${Math.round(b / 1000)} KB`;
  return `${b} B`;
}
