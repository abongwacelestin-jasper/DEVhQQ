import { describe, expect, it } from 'vitest';
import type { ApiSessionView, OnboardingState } from '../types';
import { stageOf, toSession, toSessionRecords, type Identity, type Session } from './sessionModel';

const identity = (over: Partial<Identity> = {}): Identity => ({
  member: {
    id: 'm4',
    name: 'Kofi Mensah',
    email: 'kofi@techorg.io',
    role: 'Developer',
    products: ['renewberry'],
    status: 'active',
  },
  verified: true,
  method: 'password',
  mfaMethods: ['totp'],
  serverSessionId: 'abcd1234',
  signedInAt: '2026-11-07T08:00:00Z',
  trustedDevice: false,
  ...over,
});

const profile = {
  displayName: 'Kofi',
  timezone: 'Africa/Accra',
  hoursFrom: '09:00',
  hoursTo: '17:00',
  skills: [],
  notify: [],
} as unknown as NonNullable<OnboardingState['profile']>;

const unlocked = { locked: false };

describe('sessionModel — stageOf', () => {
  const base = toSession(identity(), { stage: 'ready' }, unlocked);
  const s = (over: Partial<Session>): Session => ({ ...base, ...over });

  it('no session → signed-out', () => expect(stageOf(null)).toBe('signed-out'));

  it('an unverified second factor always wins, whatever the onboarding stage', () => {
    for (const onboardingStage of ['nda', 'profile', 'ready'] as const)
      expect(stageOf(s({ mfaVerified: false, onboardingStage }))).toBe('mfa');
  });

  it('then the server onboarding stage gates the app', () => {
    expect(stageOf(s({ onboardingStage: 'nda' }))).toBe('nda');
    expect(stageOf(s({ onboardingStage: 'profile' }))).toBe('profile');
    expect(stageOf(s({ onboardingStage: 'ready' }))).toBe('ready');
  });

  it('a locked session keeps its stage (the lock screen is separate)', () => {
    expect(stageOf(s({ locked: true }))).toBe('ready');
  });
});

describe('sessionModel — toSession', () => {
  it('derives everything from the server identity', () => {
    const sess = toSession(
      identity({ trustedDevice: true, method: 'passkey' }),
      { stage: 'ready' },
      unlocked,
    );
    expect(sess).toMatchObject({
      id: 'abcd1234',
      roleKey: 'developer',
      memberId: 'm4',
      method: 'passkey',
      mfaVerified: true,
      trustedDevice: true,
      signedInAt: '2026-11-07T08:00:00Z',
      locked: false,
      onboardingStage: 'ready',
      profileComplete: true,
    });
  });

  it.each([
    ['Owner', 'admin'],
    ['Project manager', 'pm'],
    ['Designer', 'designer'],
    ['Tester', 'tester'],
    ['Operations', 'operations'],
  ] as const)('role %s → %s', (role, key) => {
    const id = identity();
    expect(
      toSession({ ...id, member: { ...id.member, role } }, { stage: 'ready' }, unlocked).roleKey,
    ).toBe(key);
  });

  it('an unverified identity yields an mfa-stage session', () => {
    expect(stageOf(toSession(identity({ verified: false }), { stage: 'ready' }, unlocked))).toBe(
      'mfa',
    );
  });

  it('carries the NDA signature and profile from the server', () => {
    const sess = toSession(
      identity(),
      {
        stage: 'profile',
        nda: { version: 'v2', signedName: 'Kofi Mensah', signedAt: '2026-11-07T08:01:00Z' },
      },
      unlocked,
    );
    expect(sess).toMatchObject({
      ndaSignedAt: '2026-11-07T08:01:00Z',
      ndaName: 'Kofi Mensah',
      onboardingStage: 'profile',
      profileComplete: false,
    });
    expect(stageOf(sess)).toBe('profile');
    const done = toSession(identity(), { stage: 'ready', profile }, unlocked);
    expect(done.profile).toEqual(profile);
    expect(done.profileComplete).toBe(true);
  });

  it('empty or null NDA fields are not presented as signed', () => {
    const sess = toSession(
      identity(),
      { stage: 'nda', nda: { version: 'v2', signedName: '', signedAt: '' } },
      unlocked,
    );
    expect(sess.ndaSignedAt).toBeUndefined();
    expect(sess.ndaName).toBeUndefined();
    expect(
      toSession(identity(), { stage: 'nda', nda: null }, unlocked).ndaSignedAt,
    ).toBeUndefined();
    expect(stageOf(sess)).toBe('nda');
  });

  it('a backend without an onboarding module (null) enforces no NDA/profile stage', () => {
    const sess = toSession(identity(), null, unlocked);
    expect(sess.onboardingStage).toBe('ready');
    expect(sess.profileComplete).toBe(true);
  });

  it('copies the lock state', () => {
    const sess = toSession(
      identity(),
      { stage: 'ready' },
      { locked: true, lockedAt: '2026-11-07T09:00:00Z' },
    );
    expect(sess).toMatchObject({ locked: true, lockedAt: '2026-11-07T09:00:00Z' });
  });
});

describe('sessionModel — toSessionRecords', () => {
  const view = (over: Partial<ApiSessionView> = {}): ApiSessionView => ({
    id: 'abcd1234',
    memberId: 'm4',
    current: true,
    stage: 'verified',
    method: 'passkey',
    client: 'Chrome · macOS',
    ip: '154.160.2.71',
    location: { city: 'Accra', country: 'Ghana' } as ApiSessionView['location'],
    createdAt: 't0',
    lastSeenAt: 't1',
    stepUpRequired: false,
    ...over,
  });

  it('maps server views to lock-screen records', () => {
    const [r] = toSessionRecords([view()], () => 'developer');
    expect(r).toEqual({
      id: 'abcd1234',
      memberId: 'm4',
      roleKey: 'developer',
      method: 'password',
      device: 'Chrome · macOS',
      location: 'Accra, Ghana',
      ip: '154.160.2.71',
      startedAt: 't0',
      lastSeenAt: 't1',
      idleMs: 0,
      events: [],
    });
  });

  it('missing location parts degrade to what is known, then "Unknown"', () => {
    const recs = toSessionRecords(
      [
        view({ location: { city: '', country: 'Ghana' } as ApiSessionView['location'] }),
        view({ location: undefined as unknown as ApiSessionView['location'] }),
      ],
      () => 'pm',
    );
    expect(recs.map((r) => r.location)).toEqual(['Ghana', 'Unknown']);
    expect(recs.every((r) => r.roleKey === 'pm')).toBe(true);
  });
});
