import React, { useId, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { Button } from './Button';
import { ProgressBar } from './ProgressBar';
import {
  UPLOAD_LIMITS,
  useUpload,
  validateUpload,
  type UploadedFile,
  type UploadPurpose,
} from '../../hooks/useUpload';

interface FileUploadProps {
  purpose: UploadPurpose;
  /** Resource the file attaches to: doc id, channel id, or member id (avatars). */
  refId: string;
  onUploaded?: (file: UploadedFile) => void;
  label?: string;
  /** Overrides the generated constraint hint. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

const statusText: Record<string, string> = {
  preparing: 'Preparing upload…',
  uploading: 'Uploading…',
  verifying: 'Verifying file…',
  done: 'Uploaded',
  aborted: 'Upload cancelled',
};

function describeLimits(purpose: UploadPurpose): string {
  const { types, maxBytes } = UPLOAD_LIMITS[purpose];
  const kinds = [
    ...new Set(
      types.map((t) => {
        if (t.startsWith('image/')) return t.slice(6).toUpperCase();
        if (t === 'application/pdf') return 'PDF';
        if (t.includes('officedocument')) return 'Office';
        return t.split('/')[1].toUpperCase();
      }),
    ),
  ];
  return `${kinds.join(', ')} · up to ${Math.round(maxBytes / (1024 * 1024))} MB`;
}

/**
 * Accessible drop zone for direct-to-storage uploads. Keyboard: the zone is a
 * button (Enter/Space opens the file picker); status changes are announced
 * through a polite live region and errors through role="alert".
 */
export function FileUpload({
  purpose,
  refId,
  onUploaded,
  label = 'Upload a file',
  hint,
  disabled = false,
  className = '',
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const { status, progress, error, upload, abort, reset } = useUpload();
  const busy = status === 'preparing' || status === 'uploading' || status === 'verifying';
  const shownError = localError ?? (status === 'error' ? error : null);

  const start = (file: File | undefined) => {
    if (!file || busy || disabled) return;
    reset();
    setFileName(file.name);
    const invalid = validateUpload(file, purpose);
    setLocalError(invalid);
    if (invalid) return;
    upload(file, { purpose, refId })
      .then((done) => onUploaded?.(done))
      .catch(() => undefined); // state already holds the message
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 1) {
      setLocalError('Drop one file at a time.');
      return;
    }
    start(e.dataTransfer.files[0]);
  };

  return (
    <div className={`min-w-0 ${className}`}>
      <button
        type="button"
        disabled={disabled || busy}
        aria-describedby={hintId}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 ${
          dragging
            ? 'border-accent bg-accent-soft'
            : shownError
              ? 'border-bad/60 bg-bad-soft/40'
              : 'border-line-strong bg-surface hover:border-accent/60 hover:bg-sunken/60'
        }`}
      >
        <Upload aria-hidden="true" className="h-4 w-4 text-muted" />
        <span className="text-[12.5px] font-medium text-ink">
          {dragging ? 'Drop to upload' : label}
        </span>
        <span id={hintId} className="text-[11.5px] text-muted">
          {hint ?? `Drag a file here or choose one · ${describeLimits(purpose)}`}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={UPLOAD_LIMITS[purpose].types.join(',')}
        onChange={(e) => {
          start(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {(busy || status === 'done' || status === 'aborted') && fileName && (
        <div className="mt-2 flex min-w-0 items-center gap-2.5 rounded-md border border-line bg-white px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-2 text-[12px]">
              <span className="truncate font-medium text-ink">{fileName}</span>
              <span className="shrink-0 text-muted">
                {status === 'uploading' ? `${progress}%` : statusText[status]}
              </span>
            </div>
            {busy && (
              <ProgressBar
                className="mt-1.5"
                value={status === 'preparing' ? 0 : progress}
                tone={status === 'verifying' ? 'info' : 'accent'}
                label={`Uploading ${fileName}`}
              />
            )}
          </div>
          {busy && (
            <Button
              size="sm"
              variant="ghost"
              onClick={abort}
              aria-label={`Cancel uploading ${fileName}`}
              icon={<X aria-hidden="true" className="h-3.5 w-3.5" />}
            />
          )}
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {status === 'idle' || status === 'error'
          ? ''
          : `${fileName ?? 'File'}: ${statusText[status]}`}
      </p>
      {shownError && (
        <p role="alert" className="mt-1.5 text-[12px] text-bad">
          {shownError}
        </p>
      )}
    </div>
  );
}
