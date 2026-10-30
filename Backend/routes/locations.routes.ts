/**
 * Location intelligence routes.
 *
 * Powers continuous identity verification: where sign-ins come from, which
 * ones looked risky, and a sandbox to test the risk engine against any IP.
 * Members see their own history; Administration:view sees everyone's.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { can } from '../auth/rbac.ts';
import { listAllSessions, listSessions } from '../auth/sessions.ts';
import { assessRisk, distanceKm, knownRegions, lookupIp, riskDecision } from '../lib/geo.ts';
import { db } from '../store/db.ts';
import { HttpError } from '../types.ts';

const ipPattern = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]{2,39})$/i;
const assessBody = v.object({
  ip: v.string({ pattern: ipPattern }),
  memberId: v.optional(v.string({ max: 20 })),
});

export function registerLocationRoutes(r: Router) {
  r.add(
    'GET',
    '/api/locations/me',
    { summary: 'Where this request appears to come from', tag: 'locations' },
    authenticate,
    (ctx) => ({ ip: ctx.ip, location: lookupIp(ctx.ip) }),
  );

  r.add(
    'GET',
    '/api/locations/lookup',
    {
      summary: 'Resolve an IP to city, country and network type (?ip=)',
      tag: 'locations',
      responses: [401, 422],
    },
    authenticate,
    (ctx) => {
      const ip = ctx.query.get('ip') ?? '';
      if (!ipPattern.test(ip))
        throw new HttpError(422, 'validation_failed', 'ip must be an IPv4 or IPv6 address');
      return { ip, location: lookupIp(ip) };
    },
  );

  r.add(
    'GET',
    '/api/locations/regions',
    { summary: 'Known regions in the offline geo table', tag: 'locations' },
    authenticate,
    () => knownRegions(),
  );

  r.add(
    'GET',
    '/api/locations/sign-ins',
    {
      summary:
        'Sign-in history with location and risk (filter: memberId, result, country, minRisk)',
      tag: 'locations',
    },
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      const q = ctx.query;
      const admin = can(p, 'Administration', 'view');
      const who = admin ? q.get('memberId') : p.memberId;
      const minRisk = Number(q.get('minRisk') ?? 0);
      return db.signIns
        .filter(
          (s) =>
            (!who || s.memberId === who) &&
            (!q.get('result') || s.result === q.get('result')) &&
            (!q.get('country') || s.location.countryCode === q.get('country')) &&
            s.risk.score >= minRisk,
        )
        .slice(0, Math.min(500, Number(q.get('limit') ?? 100)));
    },
  );

  r.add(
    'GET',
    '/api/locations/summary',
    { summary: 'Sign-ins grouped by country, with risky counts', tag: 'locations' },
    authenticate,
    (ctx) => {
      const admin = can(ctx.principal!, 'Administration', 'view');
      const rows = db.signIns.filter((s) => admin || s.memberId === ctx.principal!.memberId);
      const by = new Map<
        string,
        {
          country: string;
          countryCode: string;
          total: number;
          failed: number;
          risky: number;
          cities: Set<string>;
        }
      >();
      for (const s of rows) {
        const k = s.location.countryCode;
        const g = by.get(k) ?? {
          country: s.location.country,
          countryCode: k,
          total: 0,
          failed: 0,
          risky: 0,
          cities: new Set<string>(),
        };
        g.total++;
        if (s.result !== 'success' && s.result !== 'challenged') g.failed++;
        if (s.risk.score >= 40) g.risky++;
        g.cities.add(s.location.city);
        by.set(k, g);
      }
      return {
        total: rows.length,
        countries: [...by.values()]
          .map((g) => ({ ...g, cities: [...g.cities] }))
          .sort((a, b) => b.total - a.total),
      };
    },
  );

  r.add(
    'GET',
    '/api/locations/sessions',
    { summary: 'Live sessions with location (all, for admins)', tag: 'locations' },
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      return can(p, 'Administration', 'view')
        ? listAllSessions(p.sessionId)
        : listSessions(p.memberId, p.sessionId);
    },
  );

  r.add(
    'POST',
    '/api/locations/assess',
    {
      summary: 'Dry-run the sign-in risk engine for an IP (no side effects)',
      tag: 'locations',
      responses: [401, 422],
    },
    authenticate,
    (ctx) => {
      const { ip, memberId } = parse(assessBody, ctx.body);
      const who =
        memberId && can(ctx.principal!, 'Administration', 'view')
          ? memberId
          : ctx.principal!.memberId;
      const location = lookupIp(ip);
      const history = db.signIns.filter((s) => s.memberId === who);
      const risk = assessRisk(location, history);
      const last = history.find((h) => h.result === 'success');
      return {
        ip,
        memberId: who,
        location,
        risk,
        decision: riskDecision(risk.score),
        fromLast: last
          ? {
              city: last.location.city,
              km: Math.round(distanceKm(last.location, location)),
              at: last.at,
            }
          : null,
      };
    },
  );
}
