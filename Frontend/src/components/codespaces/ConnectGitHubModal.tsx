import { useState } from 'react';
import { GithubIcon, LoaderCircleIcon, ShieldCheckIcon } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Resolves to an OAuth URL to open, or null when no redirect is needed (simulated). */
  getAuthorizeUrl: () => Promise<string | null>;
  onConnected: () => void;
  onUseSandbox: () => void;
}

const scopes = [
  'Create, start and stop your codespaces',
  'Read repository contents for this workspace',
  'Sign you in to the editor without a second login',
];

/** One-click GitHub authorization, shown when GitHub rejects the session or the editor can't sign in. */
export function ConnectGitHubModal({
  open,
  onClose,
  getAuthorizeUrl,
  onConnected,
  onUseSandbox,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const url = await getAuthorizeUrl();
      if (url) {
        const popup = window.open(url, 'devhq-github-auth', 'width=620,height=720');
        if (!popup) throw new Error('Allow pop-ups for TavetaHQ, then try again');
        // The OAuth callback page posts { type: 'devhq:github-connected' } back to the opener.
        await new Promise<void>((resolve, reject) => {
          const timer = setInterval(() => {
            if (popup.closed) {
              clearInterval(timer);
              window.removeEventListener('message', onMsg);
              reject(new Error('Authorization window was closed'));
            }
          }, 500);
          const onMsg = (e: MessageEvent) => {
            if ((e.data as { type?: string })?.type !== 'devhq:github-connected') return;
            clearInterval(timer);
            window.removeEventListener('message', onMsg);
            popup.close();
            resolve();
          };
          window.addEventListener('message', onMsg);
        });
      }
      onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Connect your GitHub account"
      description="Your codespace needs a GitHub sign-in that TavetaHQ can pass to the editor."
      footer={
        <>
          <Button variant="ghost" onClick={onUseSandbox}>
            Use local sandbox
          </Button>
          <Button
            variant="primary"
            onClick={connect}
            disabled={busy}
            icon={
              busy ? (
                <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GithubIcon className="h-3.5 w-3.5" />
              )
            }
          >
            Authorize GitHub
          </Button>
        </>
      }
    >
      <ul className="space-y-1.5">
        {scopes.map((s) => (
          <li key={s} className="flex items-start gap-2 text-[12.5px] text-ink">
            <ShieldCheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" /> {s}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11.5px] text-muted">
        Tokens stay on the TavetaHQ server and expire after 8 hours. You can revoke access from
        GitHub → Settings → Applications.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md bg-bad-soft px-2.5 py-1.5 text-[12px] font-medium text-bad"
        >
          {error}
        </p>
      )}
    </Modal>
  );
}
