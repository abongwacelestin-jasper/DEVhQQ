import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { RotateCwIcon, ShieldCheckIcon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import {
  loadTurnstile,
  useTurnstileSettings,
  type TurnstileAction,
  type TurnstileApi,
} from '../../api/auth/turnstile';

type Status = 'loading' | 'ready' | 'solved' | 'expired' | 'error';

const STATUS_TEXT: Record<Status, string> = {
  loading: 'Loading the security check…',
  ready: 'Complete the security check to continue.',
  solved: 'Security check complete.',
  expired: 'The security check expired. Checking again…',
  error: 'The security check could not run.',
};

interface WidgetProps {
  siteKey: string;
  action: TurnstileAction;
  /** Bump to discard the current token and run the check again. */
  resetKey: number;
  onToken: (token: string | null) => void;
}

/**
 * The Cloudflare Turnstile widget (managed mode is chosen on the widget in the
 * Cloudflare dashboard). Its theme follows the app. The iframe is keyboard
 * reachable: if Cloudflare asks for an interaction, Tab to the checkbox and
 * press Space. A labelled group and a polite live region tell screen-reader
 * users what the check is and when it is done.
 */
export function TurnstileWidget({ siteKey, action, resetKey, onToken }: WidgetProps) {
  const { theme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const tokenSink = useRef(onToken);
  const [status, setStatus] = useState<Status>('loading');
  const statusId = useId();

  useEffect(() => {
    tokenSink.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    loadTurnstile()
      .then((api) => {
        if (!alive || !host.current) return;
        const id = api.render(host.current, {
          sitekey: siteKey,
          action,
          theme,
          appearance: 'always',
          'refresh-expired': 'auto',
          callback: (token) => {
            tokenSink.current(token);
            setStatus('solved');
          },
          'expired-callback': () => {
            tokenSink.current(null);
            setStatus('expired');
          },
          'timeout-callback': () => {
            tokenSink.current(null);
            setStatus('ready');
          },
          'error-callback': () => {
            tokenSink.current(null);
            setStatus('error');
            return true; // handled here; keeps Cloudflare from throwing into the console
          },
        });
        if (id) {
          widget.current = { api, id };
          setStatus((s) => (s === 'loading' ? 'ready' : s));
        }
      })
      .catch(() => alive && setStatus('error'));
    return () => {
      alive = false;
      tokenSink.current(null);
      widget.current?.api.remove(widget.current.id);
      widget.current = null;
    };
  }, [siteKey, action, theme]);

  const retry = useCallback(() => {
    tokenSink.current(null);
    if (widget.current) {
      widget.current.api.reset(widget.current.id);
      setStatus('ready');
    }
  }, []);

  useEffect(() => {
    if (resetKey > 0) retry();
  }, [resetKey, retry]);

  return (
    <div
      role="group"
      aria-label="Security check"
      aria-describedby={statusId}
      data-turnstile-status={status}
      className="space-y-1"
    >
      <div ref={host} className="min-h-[65px]" />
      <p
        id={statusId}
        aria-live="polite"
        className="flex items-center gap-1.5 text-[11.5px] text-muted"
      >
        <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{STATUS_TEXT[status]}</span>
        {status === 'error' && (
          <button
            type="button"
            onClick={retry}
            className="ml-1 inline-flex items-center gap-1 rounded font-medium text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <RotateCwIcon className="h-3 w-3" aria-hidden /> Try again
          </button>
        )}
      </p>
    </div>
  );
}

export interface TurnstileState {
  /** True once the server said the check is on. */
  enabled: boolean;
  /** The current single-use token, or null (not solved, expired or used). */
  token: string | null;
  /** Discards the token and re-runs the check: call after every submit. */
  reset: () => void;
  /** The widget to place in the form; null while the check is off. */
  widget: React.ReactNode;
}

/** One widget per form. Tokens are single-use, so call `reset()` after each attempt. */
export function useTurnstile(action: TurnstileAction): TurnstileState {
  const settings = useTurnstileSettings();
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setResetKey((k) => k + 1);
  }, []);
  const enabled = settings?.mode === 'on' && !!settings.siteKey;
  return {
    enabled,
    token,
    reset,
    widget: enabled ? (
      <TurnstileWidget
        siteKey={settings.siteKey!}
        action={action}
        resetKey={resetKey}
        onToken={setToken}
      />
    ) : null,
  };
}

/** Message for a form when the user submits before the check has passed. */
export const TURNSTILE_PENDING = 'Complete the security check first.';
