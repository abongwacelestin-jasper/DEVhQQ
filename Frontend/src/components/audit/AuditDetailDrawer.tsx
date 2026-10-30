import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowDownIcon, CopyIcon, ShieldCheckIcon, XIcon } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { fingerprint, previousFingerprint, type AuditRow } from '../../utils/audit';
import { memberById } from '../../utils/status';
import { members } from '../../data/team';

interface AuditDetailDrawerProps {
  row: AuditRow | null;
  all: AuditRow[];
  onClose: () => void;
  onFilterActor: (id: string) => void;
}

const ease = [0.23, 1, 0.32, 1] as const;

/** Right-side drawer: who, when, where, and the hash link proving the entry is unchanged. */
export function AuditDetailDrawer({ row, all, onClose, onFilterActor }: AuditDetailDrawerProps) {
  useEffect(() => {
    if (!row) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [row, onClose]);

  const copy = (v: string) => {
    navigator.clipboard?.writeText(v);
    toast.success('Copied');
  };

  return (
    <AnimatePresence>
      {row && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-ink/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label="Event details"
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={{ duration: 0.22, ease }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-line bg-white shadow-pop"
          >
            <header className="flex items-start gap-3 border-b border-line px-4 py-3">
              <Avatar id={row.actor} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ink">{row.action}</p>
                <p className="truncate text-[12px] text-muted">{row.target}</p>
              </div>
              <button
                onClick={onClose}
                className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink"
                aria-label="Close details"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </header>

            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              <dl className="divide-y divide-line text-[12.5px]">
                {[
                  [
                    'Actor',
                    <button
                      key="a"
                      onClick={() => onFilterActor(row.actor)}
                      className="font-medium text-ink hover:underline"
                    >
                      {memberById(row.actor).name}
                    </button>,
                  ],
                  ['Role', members.find((m) => m.id === row.actor)?.role ?? '—'],
                  [
                    'When',
                    <span key="w" className="font-mono text-[12px]">
                      {row.when}
                    </span>,
                  ],
                  ['Area', row.area],
                  [
                    'Source',
                    row.source === 'session' ? 'Sign-in & session events' : 'Workspace activity',
                  ],
                  ['Sensitivity', row.sensitive ? 'Sensitive · MFA re-check required' : 'Standard'],
                  [
                    'Event ID',
                    <span key="i" className="font-mono text-[12px]">
                      {row.id}
                    </span>,
                  ],
                ].map(([k, v]) => (
                  <div
                    key={String(k)}
                    className="grid h-9 grid-cols-[104px_minmax(0,1fr)] items-center gap-2 px-4"
                  >
                    <dt className="text-muted">{k}</dt>
                    <dd className="min-w-0 truncate text-ink">{v}</dd>
                  </div>
                ))}
              </dl>

              <section className="border-t border-line px-4 py-3" aria-label="Integrity chain">
                <h3 className="text-[11.5px] font-semibold text-ink">Integrity chain</h3>
                <ol className="mt-2 space-y-1">
                  <HashRow
                    label="Previous"
                    value={previousFingerprint(all, row)}
                    onCopy={copy}
                    muted
                  />
                  <li className="flex justify-center text-subtle" aria-hidden>
                    <ArrowDownIcon className="h-3 w-3" />
                  </li>
                  <HashRow label="This entry" value={fingerprint(row)} onCopy={copy} />
                </ol>
                <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-medium text-ok">
                  <ShieldCheckIcon className="h-3.5 w-3.5" /> Verified against the append-only chain
                </p>
              </section>
            </div>

            <footer className="grid grid-cols-2 gap-1.5 border-t border-line px-4 py-2.5">
              <button
                onClick={() => onFilterActor(row.actor)}
                className="h-8 rounded-md border border-line text-[12px] font-medium text-ink hover:bg-sunken"
              >
                All by this person
              </button>
              <Link
                to={`/team/${row.actor}`}
                className="grid h-8 place-items-center rounded-md bg-ink text-[12px] font-medium text-white hover:bg-ink/90"
              >
                Open member
              </Link>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function HashRow({
  label,
  value,
  onCopy,
  muted,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
  muted?: boolean;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
      <span className="w-16 shrink-0 text-[11px] text-muted">{label}</span>
      <code
        className={`min-w-0 flex-1 truncate font-mono text-[11.5px] ${muted ? 'text-subtle' : 'text-ink'}`}
      >
        {value}
      </code>
      <button
        onClick={() => onCopy(value)}
        className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-sunken hover:text-ink"
        aria-label={`Copy ${label.toLowerCase()} fingerprint`}
      >
        <CopyIcon className="h-3 w-3" />
      </button>
    </li>
  );
}
