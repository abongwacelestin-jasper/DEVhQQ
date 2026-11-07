/**
 * Direct-to-storage uploads (STORAGE lane, WAVE4 §6).
 *
 *   1. POST /api/files/uploads   → presigned PUT (type + size pinned by the server)
 *   2. XHR PUT straight to object storage, with progress
 *   3. POST /api/files/:id/complete → server verifies size, magic bytes, scan
 *
 * `abort()` cancels whichever step is running and best-effort deletes the
 * pending upload. The limits below mirror the server's allow-list so users get
 * an immediate answer; the server remains the authority.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';

export type UploadPurpose = 'doc-attachment' | 'avatar' | 'message-attachment';

const MB = 1024 * 1024;
const RASTER = ['image/png', 'image/jpeg', 'image/webp'];
const ATTACHMENTS = [
  ...RASTER,
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export const UPLOAD_LIMITS: Record<UploadPurpose, { types: string[]; maxBytes: number }> = {
  avatar: { types: RASTER, maxBytes: 2 * MB },
  'doc-attachment': { types: ATTACHMENTS, maxBytes: 25 * MB },
  'message-attachment': { types: ATTACHMENTS, maxBytes: 25 * MB },
};

/** Browsers often report '' for .md / .csv; fall back to the extension. */
const BY_EXTENSION: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  txt: 'text/plain',
  json: 'application/json',
};

export function contentTypeOf(file: File): string {
  if (file.type) return file.type.split(';')[0].trim().toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? 'application/octet-stream';
}

/** Returns a user-facing reason the file can't be uploaded, or null. */
export function validateUpload(file: File, purpose: UploadPurpose): string | null {
  const limits = UPLOAD_LIMITS[purpose];
  if (!limits.types.includes(contentTypeOf(file)))
    return `${file.name}: this file type isn't allowed here.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > limits.maxBytes)
    return `${file.name} is larger than ${Math.round(limits.maxBytes / MB)} MB.`;
  return null;
}

export interface UploadedFile {
  id: string;
  purpose: UploadPurpose;
  refId: string;
  name: string;
  contentType: string;
  size: number;
  status: 'ready';
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

interface PresignResponse {
  fileId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export type UploadStatus =
  'idle' | 'preparing' | 'uploading' | 'verifying' | 'done' | 'error' | 'aborted';

export interface UploadState {
  status: UploadStatus;
  /** 0–100 while uploading. */
  progress: number;
  error: string | null;
  file: UploadedFile | null;
}

const initial: UploadState = { status: 'idle', progress: 0, error: null, file: null };

class AbortedError extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'AbortError';
  }
}

function putWithProgress(
  presign: PresignResponse,
  file: File,
  onProgress: (pct: number) => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open(presign.method, presign.uploadUrl);
    for (const [k, val] of Object.entries(presign.headers)) xhr.setRequestHeader(k, val);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage refused the upload (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error("Couldn't reach file storage. Check your connection."));
    xhr.onabort = () => reject(new AbortedError());
    xhr.send(file);
  });
}

export function useUpload() {
  const [state, setState] = useState<UploadState>(initial);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const fileIdRef = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      xhrRef.current?.abort();
      controllerRef.current?.abort();
    };
  }, []);

  const update = useCallback((patch: Partial<UploadState>) => {
    if (mounted.current) setState((s) => ({ ...s, ...patch }));
  }, []);

  const upload = useCallback(
    async (file: File, opts: { purpose: UploadPurpose; refId: string }): Promise<UploadedFile> => {
      const invalid = validateUpload(file, opts.purpose);
      if (invalid) {
        update({ status: 'error', error: invalid, progress: 0, file: null });
        throw new Error(invalid);
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      fileIdRef.current = null;
      update({ status: 'preparing', progress: 0, error: null, file: null });
      try {
        const presign = await api<PresignResponse>('/api/files/uploads', {
          method: 'POST',
          body: {
            purpose: opts.purpose,
            contentType: contentTypeOf(file),
            size: file.size,
            name: file.name,
            refId: opts.refId,
          },
          signal: controller.signal,
        });
        fileIdRef.current = presign.fileId;
        if (controller.signal.aborted) throw new AbortedError();
        update({ status: 'uploading' });
        await putWithProgress(
          presign,
          file,
          (progress) => update({ progress }),
          (xhr) => (xhrRef.current = xhr),
        );
        xhrRef.current = null;
        update({ status: 'verifying', progress: 100 });
        const done = await api<UploadedFile>(
          `/api/files/${encodeURIComponent(presign.fileId)}/complete`,
          {
            method: 'POST',
            signal: controller.signal,
          },
        );
        // Completed: a later abort() must not delete the finished file.
        fileIdRef.current = null;
        update({ status: 'done', file: done });
        return done;
      } catch (e) {
        const aborted = (e as Error)?.name === 'AbortError';
        const message = aborted
          ? 'Upload cancelled.'
          : e instanceof ApiError
            ? e.message
            : ((e as Error)?.message ?? 'Upload failed.');
        update({ status: aborted ? 'aborted' : 'error', error: aborted ? null : message });
        throw e;
      } finally {
        xhrRef.current = null;
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [update],
  );

  const abort = useCallback(() => {
    xhrRef.current?.abort();
    controllerRef.current?.abort();
    const id = fileIdRef.current;
    fileIdRef.current = null;
    // Best effort: a pending upload left behind is also swept server-side and by the bucket lifecycle.
    if (id)
      void api(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE', silent: true }).catch(
        () => undefined,
      );
  }, []);

  const reset = useCallback(() => setState(initial), []);

  return { ...state, upload, abort, reset };
}
