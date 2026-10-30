import { Link } from 'react-router-dom';
import { ChevronRightIcon, GitCommitHorizontalIcon } from 'lucide-react';
import { ProductMark } from '../ui/ProductMark';
import { StatusBadge } from '../ui/StatusBadge';
import { Avatar } from '../ui/Avatar';
import { firstName } from '../../utils/status';
import type { Incident } from '../../types/operations';
import type { Tone } from '../../types/portfolio';

export const incidentStatusTone: Record<Incident['status'], Tone> = {
  investigating: 'bad',
  monitoring: 'warn',
  resolved: 'ok',
};
export const severityTone: Record<Incident['severity'], Tone> = {
  SEV1: 'bad',
  SEV2: 'bad',
  SEV3: 'warn',
};
export const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** One full-width incident row: severity · title · service · owner · timing · correlated deploy. */
export function IncidentRow({ incident }: { incident: Incident }) {
  return (
    <li>
      <Link
        to={`/incidents/${incident.id}`}
        className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-2 transition-colors duration-150 hover:bg-sunken/50 md:grid-cols-[52px_minmax(0,1fr)_130px_120px_104px_92px_14px]"
      >
        <StatusBadge tone={severityTone[incident.severity]} label={incident.severity} />
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-ink">
            <ProductMark product={incident.product} size="sm" />
            <span className="truncate">{incident.title}</span>
          </p>
          <p className="truncate text-[11.5px] text-muted">
            <span className="font-mono">{incident.id}</span> · {capitalize(incident.status)}
            <span className="md:hidden"> · {incident.service}</span>
          </p>
        </div>
        <span className="hidden truncate font-mono text-[11.5px] text-ink md:block">
          {incident.service}
        </span>
        <span className="hidden min-w-0 items-center gap-1.5 text-[12px] text-ink md:flex">
          <Avatar id={incident.owner} size="xs" />
          <span className="truncate">{firstName(incident.owner)}</span>
        </span>
        <span className="text-right text-[11.5px] tabular-nums text-ink md:text-left">
          <span className="block">{incident.duration}</span>
          <span className="hidden text-muted md:block">{incident.started}</span>
        </span>
        <span className="hidden min-w-0 items-center gap-1 font-mono text-[11.5px] md:flex">
          {incident.correlatedDeploy ? (
            <span
              className="inline-flex items-center gap-1 text-warn"
              title="Correlated deploy — not proven cause"
            >
              <GitCommitHorizontalIcon className="h-3.5 w-3.5" />
              {incident.correlatedDeploy}
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </span>
        <ChevronRightIcon className="hidden h-3.5 w-3.5 text-muted md:block" />
      </Link>
    </li>
  );
}

export function IncidentRowHeader() {
  return (
    <div className="hidden grid-cols-[52px_minmax(0,1fr)_130px_120px_104px_92px_14px] gap-x-3 border-b border-line bg-sunken/40 px-3.5 py-1.5 text-[11px] font-medium text-muted md:grid">
      <span>Sev</span>
      <span>Incident</span>
      <span>Service</span>
      <span>Owner</span>
      <span>Duration</span>
      <span>Deploy</span>
      <span />
    </div>
  );
}
