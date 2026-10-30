import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  ArrowUpRightIcon,
  BirdIcon,
  CircleCheckIcon,
  CircleDotIcon,
  FlaskConicalIcon,
  GitCommitHorizontalIcon,
  GlobeIcon,
  RotateCcwIcon,
  ServerIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { ProductMark } from '../ui/ProductMark';
import { useAuth } from '../../contexts/AuthContext';
import { useReauth } from '../../contexts/ReauthContext';
import {
  canaries as seed,
  canaryErrorBudget,
  canarySteps,
  type CanaryState,
} from '../../data/deployTopology';
import { deployments, environments } from '../../data/operations';
import { products } from '../../data/portfolio';
import type { ProductId } from '../../types/portfolio';

type NodeId = 'commit' | 'ci' | 'staging' | 'canary' | 'production';
type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'live';
interface GraphNode {
  id: NodeId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
  tone: Tone;
}

const TONE: Record<Tone, { ring: string; dot: string; text: string }> = {
  ok: { ring: 'border-ok/40', dot: 'bg-ok', text: 'text-ok' },
  warn: { ring: 'border-warn/50', dot: 'bg-warn', text: 'text-warn' },
  bad: { ring: 'border-bad/50', dot: 'bg-bad', text: 'text-bad' },
  live: { ring: 'border-info/50', dot: 'bg-info', text: 'text-info' },
  idle: { ring: 'border-line', dot: 'bg-line-strong', text: 'text-subtle' },
};
const laneTone = (s?: string): Tone =>
  s === 'healthy' ? 'ok' : s === 'failed' ? 'bad' : s === 'degraded' ? 'warn' : 'idle';
const unhealthy = (c: CanaryState) =>
  !!c.candidate &&
  c.traffic > 0 &&
  (c.errorRate.candidate > canaryErrorBudget || c.errorRate.candidate > c.errorRate.stable * 3);

/** Interactive CI/CD graph per product with canary traffic control and one-click rollback. */
export function DeployTopology({ productIds }: { productIds: ProductId[] }) {
  const { log } = useAuth();
  const { requestReauth } = useReauth();
  const [state, setState] = useState<CanaryState[]>(seed);
  const [productId, setProductId] = useState<ProductId>(productIds[0] ?? 'renewberry');
  const [selected, setSelected] = useState<NodeId>('canary');
  const active = productIds.includes(productId) ? productId : productIds[0];
  const c = state.find((x) => x.product === active);
  if (!active || !c) return null;

  const lanes = environments.filter((e) => e.product === active);
  const dev = lanes.find((l) => l.env === 'development');
  const staging = lanes.find((l) => l.env === 'staging');
  const stagingDeploy = deployments.find((d) => d.product === active && d.env === 'staging');
  const bad = unhealthy(c);

  const nodes: GraphNode[] = [
    {
      id: 'commit',
      label: 'Commit',
      icon: GitCommitHorizontalIcon,
      title: dev?.sha ?? '—',
      sub: `main · ${dev?.ago ?? ''}`,
      tone: 'ok',
    },
    {
      id: 'ci',
      label: 'CI',
      icon: FlaskConicalIcon,
      title: c.ci === 'passing' ? 'Checks passing' : c.ci === 'running' ? 'Running' : 'Failing',
      sub: dev?.provider ?? '',
      tone: c.ci === 'passing' ? 'ok' : c.ci === 'running' ? 'live' : 'bad',
    },
    {
      id: 'staging',
      label: 'Staging',
      icon: ServerIcon,
      title: staging?.version ?? '—',
      sub: stagingDeploy?.failedStep
        ? `failed · ${stagingDeploy.failedStep}`
        : `${staging?.sha} · ${staging?.ago}`,
      tone: laneTone(staging?.status),
    },
    {
      id: 'canary',
      label: 'Canary',
      icon: BirdIcon,
      title: c.candidate ? `${c.candidate.version} · ${c.traffic}%` : 'No canary',
      sub: c.candidate ? `${c.errorRate.candidate}% errors` : 'Fully promoted',
      tone: !c.candidate ? 'idle' : bad ? 'bad' : c.traffic >= 100 ? 'ok' : 'live',
    },
    {
      id: 'production',
      label: 'Production',
      icon: GlobeIcon,
      title: c.stable.version,
      sub: `${100 - (c.candidate ? c.traffic : 0)}% traffic · ${c.stable.sha}`,
      tone: bad ? 'warn' : 'ok',
    },
  ];

  const update = (patch: Partial<CanaryState>) =>
    setState((s) => s.map((x) => (x.product === active ? { ...x, ...patch } : x)));
  const name = products.find((p) => p.id === active)?.name ?? active;

  const rollback = () =>
    requestReauth({
      title: `Roll back ${name} canary`,
      description: `All production traffic returns to ${c.stable.version} (${c.stable.sha}). ${c.candidate?.sha} stays deployed but receives no traffic.`,
      actionLabel: 'Verify & roll back',
      onConfirm: () => {
        const from = c.candidate;
        update({
          candidate: null,
          traffic: 0,
          errorRate: { ...c.errorRate, candidate: 0 },
          p95Ms: { ...c.p95Ms, candidate: 0 },
        });
        log('Rolled back canary', `${name} · ${from?.sha} → ${c.stable.sha}`, true);
        toast.success('Canary rolled back', {
          description: `100% of ${name} production traffic is on ${c.stable.version}.`,
        });
      },
    });

  const promote = () => {
    const next = canarySteps.find((s) => s > c.traffic) ?? 100;
    const go = () => {
      if (next >= 100 && c.candidate) {
        update({
          stable: c.candidate,
          candidate: null,
          traffic: 0,
          errorRate: { candidate: 0, stable: c.errorRate.candidate },
          p95Ms: { candidate: 0, stable: c.p95Ms.candidate },
        });
        toast.success(`${c.candidate.version} promoted to 100%`);
      } else {
        update({ traffic: next });
        toast(`Canary at ${next}% of traffic`);
      }
      log('Promoted canary', `${name} · ${c.candidate?.sha} → ${next}%`, true);
    };
    if (next >= 100)
      requestReauth({
        title: 'Promote to all traffic',
        description: `${c.candidate?.version} becomes the stable production release.`,
        actionLabel: 'Verify & promote',
        onConfirm: go,
      });
    else go();
  };

  const detail = nodes.find((n) => n.id === selected)!;

  return (
    <section
      aria-label="Deployment topology"
      className="overflow-hidden rounded-lg border border-line bg-white"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-semibold text-ink">Pipeline</h2>
        <div className="flex gap-1" role="tablist" aria-label="Product">
          {productIds.map((p) => {
            const cs = state.find((x) => x.product === p);
            return (
              <button
                key={p}
                role="tab"
                aria-selected={p === active}
                onClick={() => setProductId(p)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors duration-150 ${p === active ? 'bg-sunken text-ink' : 'text-muted hover:text-ink'}`}
              >
                <ProductMark product={p} size="sm" />
                <span className="hidden sm:inline">{products.find((x) => x.id === p)?.name}</span>
                {cs && unhealthy(cs) && (
                  <span className="h-1.5 w-1.5 rounded-full bg-bad" aria-label="Canary unhealthy" />
                )}
              </button>
            );
          })}
        </div>
        {bad && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-bad-soft px-2 py-1 text-[11.5px] font-medium text-bad">
            <TriangleAlertIcon className="h-3.5 w-3.5" /> Canary over error budget
          </span>
        )}
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Graph */}
        <div className="no-scrollbar overflow-x-auto px-3 py-4">
          <ol className="flex min-w-[640px] items-center">
            {nodes.map((n, i) => {
              const t = TONE[n.tone];
              const flowing = i < nodes.length - 1 && n.tone !== 'idle' && n.tone !== 'bad';
              return (
                <React.Fragment key={n.id}>
                  <li className="w-[19%] shrink-0">
                    <button
                      onClick={() => setSelected(n.id)}
                      aria-pressed={selected === n.id}
                      className={`w-full rounded-lg border bg-white px-2.5 py-2 text-left transition-[border-color,box-shadow] duration-150 ${t.ring} ${selected === n.id ? 'shadow-[0_0_0_2px_rgb(var(--c-accent)/0.35)]' : 'hover:border-line-strong'}`}
                    >
                      <span className="flex items-center gap-1.5 text-[10.5px] font-medium text-subtle">
                        <n.icon className="h-3 w-3" /> {n.label}
                        <span
                          className={`ml-auto h-1.5 w-1.5 rounded-full ${t.dot} ${n.tone === 'live' ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                        />
                      </span>
                      <span className="mt-1 block truncate font-mono text-[12px] font-semibold text-ink">
                        {n.title}
                      </span>
                      <span
                        className={`block truncate text-[10.5px] ${n.tone === 'bad' ? 'text-bad' : 'text-muted'}`}
                      >
                        {n.sub}
                      </span>
                      {n.id === 'canary' && c.candidate && (
                        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-sunken">
                          <motion.span
                            className={`block h-full rounded-full ${bad ? 'bg-bad' : 'bg-info'}`}
                            initial={false}
                            animate={{ width: `${c.traffic}%` }}
                            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                          />
                        </span>
                      )}
                    </button>
                  </li>
                  {i < nodes.length - 1 && (
                    <li aria-hidden className="relative h-px flex-1">
                      <svg
                        className="absolute inset-x-0 top-1/2 h-2 w-full -translate-y-1/2 overflow-visible"
                        preserveAspectRatio="none"
                      >
                        <line
                          x1="0"
                          y1="4"
                          x2="100%"
                          y2="4"
                          className={
                            nodes[i + 1].tone === 'bad' ? 'stroke-bad' : 'stroke-line-strong'
                          }
                          strokeWidth="1.5"
                          strokeDasharray={flowing ? '4 4' : undefined}
                        >
                          {flowing && (
                            <animate
                              attributeName="stroke-dashoffset"
                              from="8"
                              to="0"
                              dur="0.6s"
                              repeatCount="indefinite"
                            />
                          )}
                        </line>
                      </svg>
                    </li>
                  )}
                </React.Fragment>
              );
            })}
          </ol>
        </div>

        {/* Detail */}
        <aside className="border-t border-line p-3 lg:border-l lg:border-t-0">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-subtle">
            <detail.icon className="h-3.5 w-3.5" /> {detail.label}
          </p>
          {selected === 'canary' ? (
            c.candidate ? (
              <div className="mt-1.5 space-y-2.5">
                <p className="text-[12.5px] text-ink">
                  <span className="font-mono font-semibold">{c.candidate.sha}</span> on {c.traffic}%
                  of traffic for {c.startedAgo}
                </p>
                <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line text-[11px]">
                  <dt className="bg-sunken/60 px-2 py-1 text-subtle" />
                  <dt className="bg-sunken/60 px-2 py-1 text-subtle">Canary</dt>
                  <dt className="bg-sunken/60 px-2 py-1 text-subtle">Stable</dt>
                  <dd className="bg-white px-2 py-1 text-muted">Errors</dd>
                  <dd
                    className={`bg-white px-2 py-1 font-semibold tabular-nums ${bad ? 'text-bad' : 'text-ink'}`}
                  >
                    {c.errorRate.candidate}%
                  </dd>
                  <dd className="bg-white px-2 py-1 tabular-nums text-ink">
                    {c.errorRate.stable}%
                  </dd>
                  <dd className="bg-white px-2 py-1 text-muted">p95</dd>
                  <dd
                    className={`bg-white px-2 py-1 tabular-nums ${c.p95Ms.candidate > c.p95Ms.stable * 2 ? 'font-semibold text-warn' : 'text-ink'}`}
                  >
                    {c.p95Ms.candidate}ms
                  </dd>
                  <dd className="bg-white px-2 py-1 tabular-nums text-ink">{c.p95Ms.stable}ms</dd>
                </dl>
                <div className="flex gap-1.5">
                  <button
                    onClick={rollback}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-bad px-2.5 text-[12px] font-semibold text-white hover:bg-bad/90"
                  >
                    <RotateCcwIcon className="h-3.5 w-3.5" /> Roll back
                  </button>
                  <button
                    onClick={promote}
                    disabled={bad}
                    title={
                      bad
                        ? 'Promotion is blocked while the canary is over its error budget'
                        : undefined
                    }
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] font-medium text-ink hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ArrowUpRightIcon className="h-3.5 w-3.5" />{' '}
                    {(canarySteps.find((s) => s > c.traffic) ?? 100) >= 100
                      ? 'Promote all'
                      : `To ${canarySteps.find((s) => s > c.traffic)}%`}
                  </button>
                </div>
                <p className="text-[11px] text-subtle">
                  Rollback shifts traffic back to {c.stable.version} immediately. Promoting to 100%
                  needs MFA.
                </p>
              </div>
            ) : (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink">
                <CircleCheckIcon className="h-3.5 w-3.5 text-ok" /> No canary running.{' '}
                {c.stable.version} serves all traffic.
              </p>
            )
          ) : (
            <div className="mt-1.5 space-y-1">
              <p className="font-mono text-[13px] font-semibold text-ink">{detail.title}</p>
              <p className="text-[12px] text-muted">{detail.sub}</p>
              <p className={`flex items-center gap-1.5 text-[11.5px] ${TONE[detail.tone].text}`}>
                <CircleDotIcon className="h-3 w-3" />{' '}
                {detail.tone === 'ok'
                  ? 'Healthy'
                  : detail.tone === 'bad'
                    ? 'Failing'
                    : detail.tone === 'warn'
                      ? 'Degraded'
                      : detail.tone === 'live'
                        ? 'In progress'
                        : 'Idle'}
              </p>
              {selected === 'staging' && stagingDeploy && (
                <Link
                  to={`/deployments/${stagingDeploy.id}`}
                  className="inline-block pt-1 text-[12px] font-medium text-accent hover:underline"
                >
                  Open {stagingDeploy.id}
                </Link>
              )}
              {selected === 'production' && (
                <p className="pt-1 text-[11px] text-subtle">
                  {lanes.find((l) => l.env === 'production')?.url}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
