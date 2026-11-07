import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FingerprintIcon, Trash2Icon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { ApiError } from '../../api/client';
import { listPasskeys, registerPasskey, removePasskey } from '../../api/auth/endpoints';
import type { ApiPasskey } from '../../api/types';
import { defaultPasskeyLabel, describeWebAuthnError, passkeySupported } from '../../utils/webauthn';

/**
 * Passkeys registered on the server for the signed-in member. Registration is
 * a real WebAuthn ceremony against `/api/auth/passkeys/options`; nothing about
 * the credential is kept in the browser.
 */
export function PasskeyManager() {
  const { member, log, refresh } = useAuth();
  /** `null` = the server only reports a count (no listing endpoint yet). */
  const [keys, setKeys] = useState<ApiPasskey[] | null>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supported = passkeySupported();

  const reload = useCallback(async () => {
    try {
      setKeys(await listPasskeys());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load passkeys.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const pk = await registerPasskey(defaultPasskeyLabel());
      setKeys((l) => (l ? [...l.filter((k) => k.id !== pk.id), pk] : l));
      log('Registered passkey', pk.label, true);
      toast.success('Passkey registered', {
        description: 'Use it to sign in, approve sensitive actions and unlock.',
      });
      // The member's passkey count lives on the session; re-read it so passkey options appear.
      void refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : describeWebAuthnError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (pk: ApiPasskey) => {
    setError('');
    try {
      await removePasskey(pk.id);
      setKeys((l) => (l ? l.filter((k) => k.id !== pk.id) : l));
      log('Removed passkey', pk.label, true);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t remove the passkey.');
    }
  };

  const count = keys ? keys.length : (member?.passkeys ?? 0);

  return (
    <div className="mt-1.5 space-y-1">
      {keys === null && count > 0 && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-ink">
          <FingerprintIcon className="h-3.5 w-3.5 text-ok" /> {count} passkey
          {count === 1 ? '' : 's'} registered
        </p>
      )}
      {keys?.map((pk) => (
        <p key={pk.id} className="flex items-center gap-1.5 text-[11.5px] text-ink">
          <FingerprintIcon className="h-3.5 w-3.5 text-ok" /> {pk.label}
          <span className="text-subtle">· added {new Date(pk.createdAt).toLocaleDateString()}</span>
          <button
            onClick={() => void remove(pk)}
            aria-label={`Remove ${pk.label}`}
            className="rounded p-0.5 text-subtle hover:text-bad"
          >
            <Trash2Icon className="h-3 w-3" />
          </button>
        </p>
      ))}
      <button
        onClick={() => void add()}
        disabled={busy || !supported}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-[12px] font-medium text-ink transition-colors duration-150 hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60"
      >
        <FingerprintIcon className="h-3.5 w-3.5" />{' '}
        {busy
          ? 'Waiting for authenticator…'
          : supported
            ? 'Register a passkey on this device'
            : 'Passkeys not supported here'}
      </button>
      <p role="alert" aria-live="polite" className="text-[11.5px] text-bad">
        {error}
      </p>
    </div>
  );
}
