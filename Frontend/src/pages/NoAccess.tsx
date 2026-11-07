import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { SendIcon } from 'lucide-react';
import { LockedGateIllustration } from '../components/illustrations/LockedGateIllustration';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import { errorMessage } from '../components/work/apiState';

/** 403 for pages outside the signed-in role. Requests create a pending approval for an admin. */
export function NoAccess() {
  const { pathname } = useLocation();
  const { role, requestAccess } = useAuth();
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const why = reason.trim();
    setSending(true);
    try {
      await api<{ notified: number }>('/api/access/requests', {
        method: 'POST',
        body: why ? { path: pathname, reason: why } : { path: pathname },
      });
      requestAccess(`${pathname}${why ? ` · “${why}”` : ''}`);
      setSent(true);
      toast.success('Access requested', { description: 'The admins were notified.' });
    } catch (e) {
      toast.error('The request wasn’t sent', {
        description: errorMessage(e, 'Try again in a moment.'),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 rounded-lg border border-line bg-white px-5 py-8 md:flex-row md:items-center md:text-left">
      <LockedGateIllustration className="h-auto w-48 shrink-0" />
      <div className="min-w-0 flex-1 text-center md:text-left">
        <p className="font-mono text-[11.5px] font-semibold text-bad">403 · No access</p>
        <h1 className="mt-0.5 text-[18px] font-semibold tracking-tight text-ink">
          This area isn’t part of the {role?.label} view
        </h1>
        <p className="mt-1 text-[12.5px] text-muted">
          <code className="rounded bg-sunken px-1 font-mono text-ink">{pathname}</code> needs a
          permission your role doesn’t have. Visibility is never assumed — an admin has to grant it.
        </p>
        {sent ? (
          <p className="mt-3 rounded-md bg-ok-soft px-3 py-2 text-[12.5px] font-medium text-ok">
            Request sent. The admins have been notified and can grant it from your member page.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!sending) void submit();
            }}
            className="mt-3 flex flex-col gap-2 sm:flex-row"
          >
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why do you need access? (optional)"
              aria-label="Reason"
              className="h-8 min-w-0 flex-1 rounded-md border border-line-strong px-2.5 text-[12.5px] outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={sending}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-semibold text-white hover:bg-ink/90"
            >
              <SendIcon className="h-3.5 w-3.5" /> Request access
            </button>
          </form>
        )}
        <Link
          to={role?.home ?? '/'}
          className="mt-3 inline-block text-[12.5px] font-medium text-accent hover:underline"
        >
          Back to {role?.homeLabel}
        </Link>
      </div>
    </section>
  );
}
