/**
 * Offline IP geolocation and sign-in risk scoring.
 *
 * Continuous identity verification needs location context without shipping
 * every IP to a third party. This resolver uses a small built-in prefix table
 * (replace with a MaxMind GeoLite2 database in production — same interface).
 *
 * Risk signals:
 *  - impossible travel (speed between consecutive sign-ins > 900 km/h),
 *  - anonymising networks (Tor exit nodes, commercial VPN ranges),
 *  - datacenter IPs (automation, credential-stuffing infrastructure),
 *  - first sign-in from a new country.
 * A high score forces step-up verification or blocks the attempt.
 */

import type { GeoLocation, SignInRecord } from '../types.ts';

interface PrefixEntry {
  prefix: string;
  loc: GeoLocation;
}

const L = (
  city: string,
  country: string,
  countryCode: string,
  region: string,
  lat: number,
  lon: number,
  network: GeoLocation['network'] = 'residential',
): GeoLocation => ({ city, country, countryCode, region, lat, lon, network });

/** Longest-prefix-wins table. Entries mirror the regions our team works from. */
const table: PrefixEntry[] = [
  { prefix: '102.89.', loc: L('Lagos', 'Nigeria', 'NG', 'Africa', 6.5244, 3.3792, 'office') },
  { prefix: '154.160.', loc: L('Accra', 'Ghana', 'GH', 'Africa', 5.6037, -0.187) },
  { prefix: '91.64.', loc: L('Berlin', 'Germany', 'DE', 'Europe', 52.52, 13.405) },
  { prefix: '85.214.', loc: L('Berlin', 'Germany', 'DE', 'Europe', 52.52, 13.405, 'datacenter') },
  { prefix: '83.44.', loc: L('Madrid', 'Spain', 'ES', 'Europe', 40.4168, -3.7038) },
  { prefix: '133.32.', loc: L('Tokyo', 'Japan', 'JP', 'Asia-Pacific', 35.6762, 139.6503) },
  { prefix: '49.36.', loc: L('Pune', 'India', 'IN', 'Asia-Pacific', 18.5204, 73.8567) },
  { prefix: '177.', loc: L('São Paulo', 'Brazil', 'BR', 'Americas', -23.5505, -46.6333) },
  { prefix: '185.220.', loc: L('Unknown', 'Tor network', 'XX', 'Anonymous', 0, 0, 'tor') },
  { prefix: '104.28.', loc: L('Unknown', 'VPN provider', 'XX', 'Anonymous', 0, 0, 'vpn') },
  {
    prefix: '34.',
    loc: L('Council Bluffs', 'United States', 'US', 'Americas', 41.2619, -95.8608, 'datacenter'),
  },
  {
    prefix: '52.',
    loc: L('Ashburn', 'United States', 'US', 'Americas', 39.0438, -77.4874, 'datacenter'),
  },
  { prefix: '127.', loc: L('Localhost', 'Local', 'LO', 'Local', 0, 0, 'loopback') },
  { prefix: '::1', loc: L('Localhost', 'Local', 'LO', 'Local', 0, 0, 'loopback') },
  { prefix: '10.', loc: L('Office LAN', 'Private network', 'LO', 'Local', 0, 0, 'office') },
  { prefix: '192.168.', loc: L('Office LAN', 'Private network', 'LO', 'Local', 0, 0, 'office') },
];

const UNKNOWN = L('Unknown', 'Unknown', 'XX', 'Unknown', 0, 0, 'unknown');

export function lookupIp(ip: string): GeoLocation {
  let best: PrefixEntry | undefined;
  for (const e of table)
    if (ip.startsWith(e.prefix) && (!best || e.prefix.length > best.prefix.length)) best = e;
  return best?.loc ?? UNKNOWN;
}

export function knownRegions() {
  const seen = new Map<string, GeoLocation>();
  for (const e of table)
    if (e.loc.countryCode !== 'XX' && e.loc.countryCode !== 'LO')
      seen.set(`${e.loc.city}-${e.loc.countryCode}`, e.loc);
  return [...seen.values()];
}

/** Great-circle distance in km. */
export function distanceKm(a: GeoLocation, b: GeoLocation): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const MAX_KMH = 900;

export function assessRisk(
  loc: GeoLocation,
  history: SignInRecord[],
  at = Date.now(),
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (loc.network === 'tor') {
    score += 70;
    reasons.push('Tor exit node');
  } else if (loc.network === 'vpn') {
    score += 25;
    reasons.push('Anonymising VPN');
  } else if (loc.network === 'datacenter') {
    score += 30;
    reasons.push('Datacenter IP — likely automation');
  }

  const successes = history.filter(
    (h) =>
      h.result === 'success' && h.location.countryCode !== 'LO' && h.location.countryCode !== 'XX',
  );
  const last = successes[0];
  if (last && loc.countryCode !== 'XX' && loc.countryCode !== 'LO') {
    const km = distanceKm(last.location, loc);
    const hours = Math.max((at - new Date(last.at).getTime()) / 3_600_000, 0.01);
    if (km > 500 && km / hours > MAX_KMH) {
      score += 60;
      reasons.push(
        `Impossible travel: ${Math.round(km)} km in ${hours.toFixed(1)} h from ${last.location.city}`,
      );
    }
  }
  if (
    successes.length &&
    loc.countryCode !== 'LO' &&
    !successes.some((h) => h.location.countryCode === loc.countryCode)
  ) {
    score += 20;
    reasons.push(`First sign-in from ${loc.country}`);
  }
  return { score: Math.min(100, score), reasons };
}

/** ≥ 70 blocks, 40–69 forces a second factor even on trusted devices. */
export function riskDecision(score: number): 'allow' | 'challenge' | 'block' {
  return score >= 70 ? 'block' : score >= 40 ? 'challenge' : 'allow';
}
