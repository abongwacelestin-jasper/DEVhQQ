import { SparklesIcon } from 'lucide-react';
import { DemoBadge } from './Unavailable';
import type { TaskInsight } from './useTaskInsights';

/**
 * Compact ETA / overdue-risk chip. Always says where the number came from:
 * a trained model, the rule-based fallback, or demo data.
 */
export function TaskInsightBadge({ insight }: { insight?: TaskInsight }) {
  if (!insight) return null;
  const pct = Math.round(Math.min(1, Math.max(0, insight.overdueRisk)) * 100);
  const tone =
    pct >= 60
      ? 'bg-bad-soft text-bad'
      : pct >= 30
        ? 'bg-warn-soft text-warn'
        : 'bg-sunken text-muted';
  const eta =
    insight.etaDays !== undefined
      ? `ETA ${Math.max(0, Math.round(insight.etaDays))}d`
      : insight.eta
        ? `ETA ${new Date(insight.eta).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
        : null;
  const label = insight.source === 'model' ? (insight.model ?? 'model') : insight.source;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        title={`Overdue risk ${pct}%${eta ? ` · ${eta}` : ''} — ${insight.source === 'model' ? `predicted by ${insight.model ?? 'the ML model'}` : insight.source === 'heuristic' ? 'rule-based estimate (ML service unavailable)' : 'demo data'}`}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums ${tone}`}
      >
        <SparklesIcon className="h-3 w-3" aria-hidden />
        <span className="sr-only">Overdue risk</span>
        {pct}% risk{eta ? ` · ${eta}` : ''}
        <span className="font-medium opacity-70">· {label}</span>
      </span>
      {insight.source === 'demo' && <DemoBadge />}
    </span>
  );
}
