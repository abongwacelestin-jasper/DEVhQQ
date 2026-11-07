import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk, distanceKm, knownRegions, lookupIp, riskDecision } from '../../lib/geo.ts';
import type { GeoLocation, SignInRecord } from '../../types.ts';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function signIn(ip: string, h: number, result: SignInRecord['result'] = 'success'): SignInRecord {
  return {
    id: `s-${ip}-${h}`,
    memberId: 'm',
    at: hoursAgo(h),
    ip,
    method: 'password',
    result,
    location: lookupIp(ip),
    risk: { score: 0, reasons: [] },
  };
}

describe('lib/geo — lookup', () => {
  it('resolves table prefixes', () => {
    const cases: [string, string, GeoLocation['network']][] = [
      ['102.89.1.2', 'Lagos', 'office'],
      ['154.160.0.1', 'Accra', 'residential'],
      ['91.64.9.9', 'Berlin', 'residential'],
      ['85.214.1.1', 'Berlin', 'datacenter'],
      ['133.32.1.1', 'Tokyo', 'residential'],
      ['185.220.101.4', 'Unknown', 'tor'],
      ['104.28.7.30', 'Unknown', 'vpn'],
      ['34.1.2.3', 'Council Bluffs', 'datacenter'],
      ['127.0.0.1', 'Localhost', 'loopback'],
      ['::1', 'Localhost', 'loopback'],
      ['10.0.0.5', 'Office LAN', 'office'],
    ];
    for (const [ip, city, network] of cases) {
      const loc = lookupIp(ip);
      assert.equal(loc.city, city, ip);
      assert.equal(loc.network, network, ip);
    }
  });

  it('prefers the longest matching prefix', () => {
    // "177." (São Paulo) is a short prefix; a longer one must win when both match.
    assert.equal(lookupIp('177.1.1.1').city, 'São Paulo');
    assert.equal(lookupIp('192.168.1.1').countryCode, 'LO');
  });

  it('falls back to Unknown/XX for unlisted addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2001:db8::1', '', 'garbage'])
      assert.deepEqual(
        { cc: lookupIp(ip).countryCode, net: lookupIp(ip).network },
        { cc: 'XX', net: 'unknown' },
        ip,
      );
  });

  it('knownRegions excludes anonymous and local entries and is de-duplicated', () => {
    const regions = knownRegions();
    assert.ok(regions.length > 0);
    for (const r of regions) assert.ok(!['XX', 'LO'].includes(r.countryCode));
    const keys = regions.map((r) => `${r.city}-${r.countryCode}`);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe('lib/geo — distance', () => {
  it('is zero to itself, symmetric and roughly right for known pairs', () => {
    const lagos = lookupIp('102.89.0.1');
    const berlin = lookupIp('91.64.0.1');
    const tokyo = lookupIp('133.32.0.1');
    assert.equal(distanceKm(lagos, lagos), 0);
    assert.equal(distanceKm(lagos, berlin), distanceKm(berlin, lagos));
    // Lagos–Berlin ≈ 5 000 km, Berlin–Tokyo ≈ 8 900 km.
    assert.ok(Math.abs(distanceKm(lagos, berlin) - 5000) < 250, String(distanceKm(lagos, berlin)));
    assert.ok(Math.abs(distanceKm(berlin, tokyo) - 8900) < 250, String(distanceKm(berlin, tokyo)));
  });
});

describe('lib/geo — risk scoring', () => {
  it('scores anonymising and datacenter networks', () => {
    assert.deepEqual(assessRisk(lookupIp('185.220.1.1'), [], NOW), {
      score: 70,
      reasons: ['Tor exit node'],
    });
    assert.deepEqual(assessRisk(lookupIp('104.28.1.1'), [], NOW), {
      score: 25,
      reasons: ['Anonymising VPN'],
    });
    assert.equal(assessRisk(lookupIp('52.1.1.1'), [], NOW).score, 30);
    assert.deepEqual(assessRisk(lookupIp('127.0.0.1'), [], NOW), { score: 0, reasons: [] });
  });

  it('first sign-in ever is not "new country"', () => {
    assert.equal(assessRisk(lookupIp('91.64.1.1'), [], NOW).score, 0);
  });

  it('flags impossible travel (> 900 km/h over > 500 km)', () => {
    const history = [signIn('102.89.1.1', 1)]; // Lagos, 1 h ago
    const r = assessRisk(lookupIp('133.32.1.1'), history, NOW); // Tokyo now
    assert.ok(
      r.reasons.some((x) => x.startsWith('Impossible travel')),
      r.reasons.join(),
    );
    assert.ok(r.reasons.some((x) => x === 'First sign-in from Japan'));
    assert.equal(r.score, 80);
    assert.equal(riskDecision(r.score), 'block');
  });

  it('the same trip with enough time in between is plausible', () => {
    const history = [signIn('102.89.1.1', 24)]; // Lagos → Tokyo in 24 h ≈ 560 km/h
    const r = assessRisk(lookupIp('133.32.1.1'), history, NOW);
    assert.ok(!r.reasons.some((x) => x.startsWith('Impossible travel')));
    assert.equal(r.score, 20, 'only the new-country signal');
  });

  it('short hops are never impossible travel, whatever the speed', () => {
    // Berlin → Berlin datacenter: 0 km in 1 minute.
    const r = assessRisk(lookupIp('85.214.0.1'), [signIn('91.64.0.1', 1 / 60)], NOW);
    assert.ok(!r.reasons.some((x) => x.startsWith('Impossible travel')));
  });

  it('compares against the most recent successful, locatable sign-in only', () => {
    const history = [
      signIn('133.32.1.1', 0.5, 'failed'), // failed attempts do not count
      signIn('127.0.0.1', 0.6), // local does not count
      signIn('185.220.1.1', 0.7), // anonymous does not count
      signIn('91.64.1.1', 30), // last real success: Berlin, 30 h ago
    ];
    const r = assessRisk(lookupIp('102.89.1.1'), history, NOW);
    assert.ok(!r.reasons.some((x) => x.startsWith('Impossible travel')), r.reasons.join());
    assert.ok(r.reasons.includes('First sign-in from Nigeria'));
  });

  it('a known country is not "new"', () => {
    const r = assessRisk(lookupIp('91.64.9.9'), [signIn('91.64.1.1', 48)], NOW);
    assert.deepEqual(r, { score: 0, reasons: [] });
  });

  it('caps the score at 100', () => {
    // Tor (70) + impossible travel cannot apply (XX) → use datacenter + travel + new country.
    const history = [signIn('102.89.1.1', 0.5)];
    const r = assessRisk(lookupIp('34.1.1.1'), history, NOW); // US datacenter, 30 min after Lagos
    assert.equal(r.score, Math.min(100, 30 + 60 + 20));
    assert.equal(r.score, 100);
  });

  it('riskDecision thresholds: <40 allow, 40–69 challenge, ≥70 block', () => {
    const expect = (s: number) => (s >= 70 ? 'block' : s >= 40 ? 'challenge' : 'allow');
    for (let s = 0; s <= 100; s++) assert.equal(riskDecision(s), expect(s), String(s));
    assert.equal(riskDecision(39), 'allow');
    assert.equal(riskDecision(40), 'challenge');
    assert.equal(riskDecision(69), 'challenge');
    assert.equal(riskDecision(70), 'block');
  });
});
