/**
 * In-process request metrics: counts, status-code mix and latency percentiles
 * per route. Exposed as JSON (/api/_metrics) and Prometheus text
 * (/api/_metrics?format=prometheus) so it plugs into existing monitoring.
 * These numbers are also how we track MTTD: alerting on 5xx and 401 spikes.
 */

interface RouteStats {
  count: number;
  errors: number;
  statuses: Record<string, number>;
  /** Last N latencies (ms) for percentile estimation. */
  samples: number[];
}

const SAMPLE_SIZE = 200;
const startedAt = Date.now();
const routes = new Map<string, RouteStats>();

function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export const metrics = {
  record(route: string, status: number, ms: number) {
    const s = routes.get(route) ?? { count: 0, errors: 0, statuses: {}, samples: [] };
    s.count++;
    if (status >= 500) s.errors++;
    s.statuses[status] = (s.statuses[status] ?? 0) + 1;
    s.samples.push(ms);
    if (s.samples.length > SAMPLE_SIZE) s.samples.shift();
    routes.set(route, s);
  },

  snapshot() {
    const list = [...routes.entries()].map(([route, s]) => {
      const sorted = [...s.samples].sort((a, b) => a - b);
      return {
        route,
        count: s.count,
        errors: s.errors,
        statuses: s.statuses,
        p50: round(pct(sorted, 50)),
        p95: round(pct(sorted, 95)),
        p99: round(pct(sorted, 99)),
      };
    });
    const total = list.reduce((n, r) => n + r.count, 0);
    const statuses: Record<string, number> = {};
    for (const r of list)
      for (const [k, v] of Object.entries(r.statuses)) statuses[k] = (statuses[k] ?? 0) + v;
    const mem = process.memoryUsage();
    return {
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      totalRequests: total,
      statuses,
      memoryMb: { rss: round(mem.rss / 1e6), heapUsed: round(mem.heapUsed / 1e6) },
      routes: list.sort((a, b) => b.count - a.count),
    };
  },

  prometheus(): string {
    const lines = [
      '# HELP devhq_requests_total Requests by route and status',
      '# TYPE devhq_requests_total counter',
    ];
    for (const [route, s] of routes) {
      for (const [status, n] of Object.entries(s.statuses))
        lines.push(`devhq_requests_total{route="${route}",status="${status}"} ${n}`);
    }
    lines.push(
      '# HELP devhq_request_p95_ms 95th percentile latency',
      '# TYPE devhq_request_p95_ms gauge',
    );
    for (const [route, s] of routes)
      lines.push(
        `devhq_request_p95_ms{route="${route}"} ${round(
          pct(
            [...s.samples].sort((a, b) => a - b),
            95,
          ),
        )}`,
      );
    lines.push(`devhq_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`);
    return lines.join('\n') + '\n';
  },
};

function round(n: number) {
  return Math.round(n * 100) / 100;
}
