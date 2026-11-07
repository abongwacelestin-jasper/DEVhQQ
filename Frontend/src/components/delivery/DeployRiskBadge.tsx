import { useId, useState } from 'react';
import { BrainCircuitIcon, ChevronDownIcon, ScaleIcon } from 'lucide-react';
import { useInsights } from '../engineering/data/hooks';
import type { Tone } from '../../types/portfolio';
import { StatusBadge } from '../ui/StatusBadge';

const toneOf: Record<'low' | 'medium' | 'high', Tone> = { low: 'ok', medium: 'warn', high: 'bad' };

/**
 * Deploy-risk insight from `GET /api/insights/deployments/:id`.
 *
 * Says whether the trained model or the rule-based fallback produced it, and
 * why. Renders nothing unless the insight loaded — a missing ML service is not
 * an error a deployer needs to see.
 */
export function DeployRiskBadge({ deploymentId }: { deploymentId: string }) {
  const { data, status } = useInsights(deploymentId);
  const [open, setOpen] = useState(false);
  const panel = useId();
  if (status !== 'ready' || !data) return null;

  const pct = Math.round(Math.max(0, Math.min(1, data.probability)) * 100);
  const model = data.source === 'model';
  return (
    <section
      aria-label="Deployment risk"
      className="rounded-lg border border-line bg-white px-3.5 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={toneOf[data.level]} label={`${data.level} risk · ${pct}%`} dot />
        <span
          className="inline-flex items-center gap-1 rounded border border-line bg-sunken/60 px-1.5 py-px font-mono text-[10.5px] text-muted"
          title={
            model
              ? 'Scored by the trained deploy-risk model'
              : 'The ML service was unavailable; scored by the rule-based heuristic'
          }
        >
          {model ? (
            <BrainCircuitIcon className="h-3 w-3" aria-hidden />
          ) : (
            <ScaleIcon className="h-3 w-3" aria-hidden />
          )}
          {model ? 'model' : 'heuristic'}
          {data.model ? ` · ${data.model.version}${data.model.trainedOn === 'synthetic' ? ' (synthetic training data)' : ''}` : ''}
        </span>
        {data.drivers.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panel}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-accent hover:bg-accent-soft"
          >
            Why
            <ChevronDownIcon
              className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
        )}
      </div>
      {open && (
        <ul id={panel} className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-ink">
          {data.drivers.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
