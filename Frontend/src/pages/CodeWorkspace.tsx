import { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CloudOffIcon, CloudIcon, XIcon } from 'lucide-react';
import { IdeWorkbench } from '../components/ide/IdeWorkbench';
import { CodespaceWorkbench } from '../components/codespaces/CodespaceWorkbench';
import { CodespaceErrorBoundary } from '../components/codespaces/CodespaceErrorBoundary';
import { LockScreen } from '../components/auth/LockScreen';
import { NoAccess } from './NoAccess';
import { useAuth } from '../contexts/AuthContext';
import { useIdleLock } from '../hooks/useIdleLock';
import { useGitHubApp } from '../hooks/useGitHubApp';
import { backendTransport, simulatedTransport } from '../utils/codespacesApi';
import type { ProductId } from '../types/portfolio';

type Mode = 'codespace' | 'sandbox';
const MODE_KEY = 'devhq.code.mode';
const API_KEY = 'devhq.codespaces.api';

/**
 * Code workspace. Prefers a GitHub Codespace (editor + forwarded-port preview); any failure
 * — API error, rate limit, missing permission, crash — drops to the local DevHQ sandbox
 * with a dismissible banner. Reached at /code and /products/:productId/ide.
 */
export function CodeWorkspace() {
  const { can, canSeeProduct, session } = useAuth();
  const { productId } = useParams();
  const [params] = useSearchParams();
  const { repos } = useGitHubApp();
  useIdleLock();

  const product = (productId ?? params.get('product')) as ProductId | null;
  const visible = repos
    .filter((r) => canSeeProduct(r.product) && (!product || r.product === product))
    .map((r) => r.name);
  const [repo, setRepo] = useState(() => visible[0] ?? 'renewberry/api');
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem(MODE_KEY) as Mode) || 'codespace',
  );
  const [fallback, setFallback] = useState<string | null>(null);
  const [bannerOpen, setBannerOpen] = useState(true);

  // A DevHQ API URL in localStorage switches from the simulated transport to the real proxy.
  const transport = useMemo(() => {
    const api = localStorage.getItem(API_KEY);
    return api ? backendTransport(api) : simulatedTransport();
  }, []);

  const choose = useCallback((m: Mode) => {
    setMode(m);
    localStorage.setItem(MODE_KEY, m);
    if (m === 'codespace') setFallback(null);
  }, []);

  const fallBack = useCallback((reason: string) => {
    setFallback(reason);
    setBannerOpen(true);
  }, []);

  if (!can('code')) {
    return (
      <div className="min-h-screen w-full bg-white p-6">
        <NoAccess />
      </div>
    );
  }

  const showCodespace = mode === 'codespace' && !fallback;

  return (
    <>
      {showCodespace ? (
        <CodespaceErrorBoundary onError={fallBack}>
          <CodespaceWorkbench
            key={repo}
            transport={transport}
            repo={repo}
            repos={visible.length ? visible : [repo]}
            onRepoChange={setRepo}
            gitRef="main"
            onFallback={fallBack}
            onUseSandbox={() => choose('sandbox')}
          />
        </CodespaceErrorBoundary>
      ) : (
        <div className="flex h-[100dvh] w-full flex-col">
          <AnimatePresence initial={false}>
            {(fallback ? bannerOpen : true) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className={`shrink-0 overflow-hidden border-b ${fallback ? 'border-warn/30 bg-warn-soft' : 'border-line bg-sunken'}`}
                role={fallback ? 'alert' : undefined}
              >
                <div className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
                  {fallback ? (
                    <CloudOffIcon className="h-3.5 w-3.5 shrink-0 text-warn" />
                  ) : (
                    <CloudIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
                  )}
                  <p className="min-w-0 flex-1 truncate text-ink">
                    {fallback ? (
                      <>
                        <b className="font-semibold">
                          Cloud Codespace unavailable. Running on local DevHQ sandbox fallback mode.
                        </b>{' '}
                        <span className="text-muted">{fallback}</span>
                      </>
                    ) : (
                      <span className="text-muted">Local DevHQ sandbox</span>
                    )}
                  </p>
                  <button
                    onClick={() => choose('codespace')}
                    className="h-6 shrink-0 rounded-md border border-line bg-white px-2 text-[11.5px] font-medium text-ink hover:border-line-strong"
                  >
                    {fallback ? 'Retry Codespace' : 'Open Codespace'}
                  </button>
                  {fallback && (
                    <button
                      onClick={() => setBannerOpen(false)}
                      aria-label="Dismiss"
                      className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:bg-white/60 hover:text-ink"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="min-h-0 flex-1 [&>*]:!h-full">
            <IdeWorkbench />
          </div>
        </div>
      )}
      {session?.locked && <LockScreen />}
    </>
  );
}
