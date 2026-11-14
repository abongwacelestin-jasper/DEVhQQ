import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftIcon,
  CloudIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  LaptopIcon,
  LoaderCircleIcon,
  MonitorIcon,
  MoonIcon,
  PowerIcon,
  RefreshCwIcon,
  CodeIcon,
} from 'lucide-react';
import { useCodespace } from '../../hooks/useCodespace';
import { useResizable } from '../../hooks/useResizable';
import { CodespaceStatusBadge } from './CodespaceStatusBadge';
import { ConnectGitHubModal } from './ConnectGitHubModal';
import { simulatedEditorDoc, simulatedPreviewDoc } from '../../utils/codespaceSimDocs';
import type { CodespacesTransport } from '../../utils/codespacesApi';

interface Props {
  transport: CodespacesTransport;
  repo: string;
  repos: string[];
  onRepoChange: (repo: string) => void;
  gitRef: string;
  onFallback: (reason: string) => void;
  onUseSandbox: () => void;
}

const IFRAME_ALLOW =
  'clipboard-read; clipboard-write; microphone; camera; midi; encrypted-media; gyroscope; picture-in-picture';
const LOAD_WATCHDOG_MS = 20_000;
const QUICK_PORTS = [3000, 5173, 8080];
const ease = [0.23, 1, 0.32, 1] as const;

/** Codespace editor (left) + forwarded-port preview (right), driven by the lifecycle hook. */
export function CodespaceWorkbench({
  transport,
  repo,
  repos,
  onRepoChange,
  gitRef,
  onFallback,
  onUseSandbox,
}: Props) {
  const cs = useCodespace({ transport, repo, ref: gitRef, onFatal: onFallback });
  const [port, setPort] = useState<number>(
    () => Number(localStorage.getItem('devhq.codespaces.port')) || 5173,
  );
  const [portDraft, setPortDraft] = useState(String(port));
  const [previewKey, setPreviewKey] = useState(0);
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [editorStuck, setEditorStuck] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<'editor' | 'preview'>('editor');
  const split = useResizable({
    axis: 'x',
    initial: typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.6) : 800,
    min: 360,
    max: typeof window !== 'undefined' ? window.innerWidth - 300 : 1400,
  });
  const simulated = transport.kind === 'simulated';
  const ready = cs.phase === 'available' && !!cs.codespace;

  useEffect(() => {
    if (cs.phase === 'auth-required') setAuthOpen(true);
  }, [cs.phase]);

  // Watchdog: a cross-origin login redirect or framing refusal never reports a clean load.
  const webUrl = cs.codespace?.web_url;
  useEffect(() => {
    setEditorLoaded(false);
    setEditorStuck(false);
    if (!ready || simulated) return;
    const t = setTimeout(() => setEditorStuck(true), LOAD_WATCHDOG_MS);
    return () => clearTimeout(t);
  }, [ready, simulated, webUrl]);

  const previewUrl = useMemo(
    () => (cs.codespace ? transport.portUrl(cs.codespace, port) : ''),
    [cs.codespace, transport, port],
  );
  const applyPort = (p: number) => {
    if (!Number.isInteger(p) || p < 1 || p > 65535) return setPortDraft(String(port));
    setPort(p);
    setPortDraft(String(p));
    localStorage.setItem('devhq.codespaces.port', String(p));
    setPreviewKey((k) => k + 1);
  };

  const editorFrame = ready && cs.codespace && (
    <iframe
      key={cs.codespace.web_url}
      title={`VS Code — ${repo}`}
      {...(simulated
        ? { srcDoc: simulatedEditorDoc(repo, gitRef, cs.codespace.name) }
        : { src: cs.codespace.web_url })}
      allow={IFRAME_ALLOW}
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={() => {
        setEditorLoaded(true);
        setEditorStuck(false);
      }}
      className="h-full w-full border-0 bg-[#1e1e1e]"
    />
  );

  const previewFrame = ready && cs.codespace && (
    <iframe
      key={`${previewKey}-${port}`}
      title={`Preview on port ${port}`}
      {...(simulated ? { srcDoc: simulatedPreviewDoc(port) } : { src: previewUrl })}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      allow="clipboard-read; clipboard-write"
      className="h-full w-full border-0 bg-white"
    />
  );

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-canvas text-ink">
      {/* Toolbar */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-white px-2.5">
        <Link
          to="/"
          aria-label="Back to TavetaHQ"
          className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </Link>
        <CloudIcon className="hidden h-4 w-4 text-accent sm:block" />
        <select
          value={repo}
          onChange={(e) => onRepoChange(e.target.value)}
          aria-label="Repository"
          className="h-7 min-w-0 max-w-[200px] rounded-md border border-line bg-white px-2 font-mono text-[12px] outline-none focus:border-accent"
        >
          {repos.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <span className="hidden items-center gap-1 font-mono text-[11.5px] text-muted md:flex">
          <GitBranchIcon className="h-3.5 w-3.5" />
          {cs.codespace?.git_status?.ref ?? gitRef}
        </span>
        <CodespaceStatusBadge phase={cs.phase} />
        {simulated && (
          <span className="hidden rounded bg-sunken px-1.5 py-0.5 text-[10.5px] font-medium text-muted lg:inline">
            Simulated · preview mode
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {cs.codespace?.machine && (
            <span className="hidden text-[11px] text-subtle xl:inline">
              {cs.codespace.machine.display_name}
            </span>
          )}
          {ready && (
            <>
              <a
                href={cs.codespace!.web_url}
                target="_blank"
                rel="noreferrer"
                className="hidden h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted hover:bg-sunken hover:text-ink sm:inline-flex"
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" /> Open in tab
              </a>
              <button
                onClick={() => void cs.stop()}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-muted hover:bg-sunken hover:text-ink"
                title="Stop codespace to save compute"
              >
                <PowerIcon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Stop</span>
              </button>
            </>
          )}
          <button
            onClick={onUseSandbox}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-medium text-ink hover:border-line-strong"
          >
            <LaptopIcon className="h-3.5 w-3.5" />{' '}
            <span className="hidden sm:inline">Local sandbox</span>
          </button>
        </div>
      </header>

      {/* Mobile pane switch */}
      <div className="flex shrink-0 border-b border-line bg-white lg:hidden" role="tablist">
        {(['editor', 'preview'] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={mobilePane === p}
            onClick={() => setMobilePane(p)}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-[12px] font-medium ${mobilePane === p ? 'border-ink text-ink' : 'border-transparent text-muted'}`}
          >
            {p === 'editor' ? (
              <CodeIcon className="h-3.5 w-3.5" />
            ) : (
              <MonitorIcon className="h-3.5 w-3.5" />
            )}
            {p === 'editor' ? 'Editor' : `Preview :${port}`}
          </button>
        ))}
      </div>

      {/* Panes */}
      <div className="relative flex min-h-0 flex-1">
        <section
          aria-label="Editor"
          className={`relative min-w-0 flex-1 bg-[#1e1e1e] lg:w-[var(--split)] lg:flex-none ${mobilePane === 'editor' ? 'block' : 'hidden'} lg:block`}
          style={{ ['--split' as string]: `${split.size}px` } as React.CSSProperties}
        >
          <div className="h-full">
            {editorFrame}
            {ready && !simulated && !editorLoaded && !editorStuck && (
              <div className="absolute inset-0 grid place-items-center text-[12px] text-white/70">
                <span className="inline-flex items-center gap-2">
                  <LoaderCircleIcon className="h-4 w-4 animate-spin" /> Opening VS Code…
                </span>
              </div>
            )}
            {editorStuck && (
              <div className="absolute inset-0 grid place-items-center bg-[#1e1e1e]/95 p-4">
                <div className="max-w-sm rounded-xl border border-white/10 bg-[#252526] p-4 text-white">
                  <p className="text-[13px] font-semibold">The editor didn’t finish loading</p>
                  <p className="mt-1 text-[12px] text-white/70">
                    This usually means GitHub asked for a sign-in inside the frame, or your
                    organization blocks embedding.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setAuthOpen(true)}
                      className="h-7 rounded-md bg-white px-2.5 text-[12px] font-semibold text-[#1e1e1e]"
                    >
                      Connect GitHub
                    </button>
                    <a
                      href={webUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7 items-center rounded-md border border-white/20 px-2.5 text-[12px] font-medium"
                    >
                      Open in new tab
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="hidden lg:block">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panes"
            onPointerDown={split.onPointerDown}
            className="h-full w-1 cursor-col-resize bg-line transition-colors duration-150 hover:bg-accent"
          />
        </div>

        <section
          aria-label="App preview"
          className={`min-w-0 flex-1 flex-col bg-white ${mobilePane === 'preview' ? 'flex' : 'hidden'} lg:flex`}
        >
          <form
            className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-2"
            onSubmit={(e) => {
              e.preventDefault();
              applyPort(Number(portDraft));
            }}
          >
            <label className="flex items-center gap-1 text-[11.5px] text-muted">
              Port
              <input
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value.replace(/\D/g, '').slice(0, 5))}
                onBlur={() => applyPort(Number(portDraft))}
                inputMode="numeric"
                aria-label="Forwarded port"
                className="h-6 w-16 rounded border border-line bg-white px-1.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
              />
            </label>
            {QUICK_PORTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPort(p)}
                className={`h-6 rounded px-1.5 font-mono text-[11px] ${p === port ? 'bg-ink text-white' : 'text-muted hover:bg-sunken hover:text-ink'}`}
              >
                {p}
              </button>
            ))}
            <span className="ml-1 min-w-0 flex-1 truncate font-mono text-[11px] text-subtle">
              {previewUrl}
            </span>
            <button
              type="button"
              onClick={() => setPreviewKey((k) => k + 1)}
              aria-label="Reload preview"
              className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-sunken hover:text-ink"
            >
              <RefreshCwIcon className="h-3.5 w-3.5" />
            </button>
            {previewUrl && !simulated && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open preview in new tab"
                className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-sunken hover:text-ink"
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" />
              </a>
            )}
          </form>
          <div className="min-h-0 flex-1">{previewFrame}</div>
        </section>

        {/* Lifecycle overlays */}
        <AnimatePresence>
          {(cs.phase === 'checking' ||
            cs.phase === 'not-found' ||
            cs.phase === 'provisioning' ||
            cs.phase === 'starting') && (
            <motion.div
              key="busy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease }}
              className="absolute inset-0 z-10 grid place-items-center bg-canvas/90 p-4 backdrop-blur-[2px]"
            >
              <div className="w-full max-w-sm rounded-xl border border-line bg-white p-4 shadow-pop">
                <div className="flex items-center gap-2.5">
                  <LoaderCircleIcon className="h-4 w-4 animate-spin text-accent" />
                  <p className="text-[13px] font-semibold">
                    {cs.phase === 'checking'
                      ? 'Looking for your codespace…'
                      : cs.phase === 'starting'
                        ? 'Starting environment…'
                        : 'Provisioning a new codespace…'}
                  </p>
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  {cs.phase === 'checking'
                    ? `Checking GitHub for an existing codespace on ${repo}.`
                    : cs.phase === 'starting'
                      ? 'Resuming your container. Unsaved editor state is restored.'
                      : `Building the dev container for ${repo} on ${gitRef}. This takes about a minute on GitHub.`}
                </p>
                {(cs.phase === 'provisioning' || cs.phase === 'starting') && (
                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                        style={{ width: `${cs.progress}%` }}
                      />
                    </div>
                    <p className="mt-1 text-right text-[11px] tabular-nums text-subtle">
                      {cs.progress}%
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
          {cs.phase === 'sleeping' && (
            <motion.div
              key="sleep"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease }}
              className="absolute inset-0 z-10 grid place-items-center bg-canvas/85 p-4 backdrop-blur-[2px]"
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.2, ease }}
                className="w-full max-w-sm rounded-xl border border-line bg-white p-4 text-center shadow-pop"
              >
                <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-sunken text-muted">
                  <MoonIcon className="h-5 w-5" />
                </span>
                <p className="mt-2 text-[14px] font-semibold">Your codespace went to sleep</p>
                <p className="mt-1 text-[12px] text-muted">
                  It stopped after {cs.codespace?.idle_timeout_minutes ?? 30} minutes without
                  activity. Files and uncommitted changes are kept.
                </p>
                <button
                  onClick={() => void cs.wake()}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3.5 text-[12.5px] font-semibold text-white hover:bg-ink/90"
                >
                  <PowerIcon className="h-3.5 w-3.5" /> Wake up environment
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ConnectGitHubModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        getAuthorizeUrl={() => transport.authorizeUrl()}
        onConnected={() => {
          setAuthOpen(false);
          void cs.retry();
        }}
        onUseSandbox={() => {
          setAuthOpen(false);
          onUseSandbox();
        }}
      />
    </div>
  );
}
