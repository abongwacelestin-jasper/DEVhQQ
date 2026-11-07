import { Link } from 'react-router-dom';
import { ShieldCheckIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { SessionsPanel } from '../components/security/SessionsPanel';

/** Every browser and device signed in to your account, from the server. Every role. */
export function Sessions() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Sessions & devices"
        description="Where your account is signed in right now. Revoke anything you don’t recognise, then change your password in Settings."
      />
      <SessionsPanel title="Signed-in sessions" />
      <p className="flex items-start gap-1.5 text-[12px] text-muted">
        <ShieldCheckIcon className="mt-px h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
        <span>
          A session used from a new network asks for re-verification, and one used from a different
          browser is signed out automatically. Changing your password signs out every other session.{' '}
          <Link to="/settings" className="font-medium text-accent hover:underline">
            Go to Settings
          </Link>
        </span>
      </p>
    </div>
  );
}
