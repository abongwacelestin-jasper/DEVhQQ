import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { config } from '../../config/env.ts';
import { issueChallenge, verifyAssertion, verifyRegistration } from '../../auth/webauthn.ts';
import { HttpError, type PasskeyCredential } from '../../types.ts';
import {
  FLAG_UP,
  FLAG_UV,
  createAuthenticator,
  makeAssertion,
  makeRegistration,
  type AssertionOverrides,
  type SoftAuthenticator,
} from '../helpers/webauthn.ts';

const ORIGIN = config.appOrigin;
const RP_ID = config.rpId;

function ceremony(kind: 'get' | 'create', memberId?: string) {
  const c = issueChallenge(kind, memberId);
  return {
    challengeId: c.challengeId,
    challenge: c.publicKey.challenge,
    rpId: RP_ID,
    origin: ORIGIN,
  };
}

function stored(auth: SoftAuthenticator, signCount = 0): PasskeyCredential {
  return {
    id: auth.credentialId,
    publicKey: auth.publicKey,
    algorithm: auth.algorithm,
    signCount,
    createdAt: new Date().toISOString(),
    label: 'test',
  };
}

function rejects(fn: () => unknown, status: number, code: string) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof HttpError, `HttpError expected, got ${String(e)}`);
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    return true;
  });
}

describe('auth/webauthn — challenges', () => {
  it('issues random challenges with the RP and allowed algorithms', () => {
    const a = issueChallenge('get');
    const b = issueChallenge('get');
    assert.notEqual(a.challengeId, b.challengeId);
    assert.notEqual(a.publicKey.challenge, b.publicKey.challenge);
    assert.equal(a.publicKey.rpId, RP_ID);
    assert.equal(a.publicKey.userVerification, 'required');
    assert.deepEqual(
      a.publicKey.pubKeyCredParams.map((p) => p.alg),
      config.crypto.webauthnAlgorithms,
    );
  });

  it('a challenge is single use, even when the first attempt fails', () => {
    const auth = createAuthenticator();
    const c = ceremony('get');
    // First attempt: wrong origin → rejected, challenge burnt.
    rejects(
      () =>
        verifyAssertion(stored(auth), makeAssertion(auth, c, { origin: 'https://evil.example' })),
      400,
      'origin_mismatch',
    );
    // Second attempt with a perfect assertion on the same challenge → refused.
    rejects(() => verifyAssertion(stored(auth), makeAssertion(auth, c)), 400, 'challenge_invalid');
  });

  it('a successful challenge cannot be replayed', () => {
    const auth = createAuthenticator();
    const c = ceremony('get');
    const body = makeAssertion(auth, c);
    assert.equal(verifyAssertion(stored(auth), body), 1);
    rejects(() => verifyAssertion(stored(auth, 1), body), 400, 'challenge_invalid');
  });

  it('expires after two minutes (fake time)', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    const auth = createAuthenticator();
    const ok = ceremony('get');
    t.mock.timers.tick(2 * 60_000);
    assert.equal(verifyAssertion(stored(auth), makeAssertion(auth, ok)), 1, 'valid at exactly TTL');
    const late = ceremony('get');
    t.mock.timers.tick(2 * 60_000 + 1);
    rejects(
      () => verifyAssertion(stored(auth), makeAssertion(auth, late)),
      400,
      'challenge_invalid',
    );
  });

  it('a create challenge cannot be used for get, and unknown ids fail', () => {
    const auth = createAuthenticator();
    const c = ceremony('create', 'm1');
    rejects(() => verifyAssertion(stored(auth), makeAssertion(auth, c)), 400, 'challenge_invalid');
    rejects(
      () =>
        verifyAssertion(
          stored(auth),
          makeAssertion(auth, { ...ceremony('get'), challengeId: 'nope' }),
        ),
      400,
      'challenge_invalid',
    );
  });
});

describe('auth/webauthn — assertions with real keys', () => {
  for (const alg of [-7, -257] as const) {
    it(`verifies a genuine ${alg === -7 ? 'ES256' : 'RS256'} assertion and returns the new counter`, () => {
      const auth = createAuthenticator(alg);
      assert.equal(
        verifyAssertion(stored(auth, 4), makeAssertion(auth, ceremony('get'), { signCount: 5 })),
        5,
      );
    });
  }

  it('accepts authenticators that never increment (counter 0 → 0)', () => {
    const auth = createAuthenticator();
    assert.equal(
      verifyAssertion(stored(auth, 0), makeAssertion(auth, ceremony('get'), { signCount: 0 })),
      0,
    );
  });

  const cases: [string, AssertionOverrides, number, string][] = [
    ['wrong ceremony type', { type: 'webauthn.create' }, 400, 'client_data_invalid'],
    ['challenge mismatch', { challenge: 'not-the-challenge' }, 400, 'client_data_invalid'],
    ['phishing origin', { origin: 'https://devhq.app.evil.example' }, 400, 'origin_mismatch'],
    ['cross-origin iframe', { crossOrigin: true }, 400, 'origin_mismatch'],
    [
      'wrong RP ID hash',
      { rpIdHashOverride: createHash('sha256').update('evil.example').digest() },
      400,
      'rp_mismatch',
    ],
    ['user not present', { flags: FLAG_UV }, 400, 'user_not_present'],
    ['user not verified', { flags: FLAG_UP }, 400, 'user_not_verified'],
    [
      'signed by another key',
      { signWith: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey },
      401,
      'signature_invalid',
    ],
  ];
  for (const [name, o, status, code] of cases) {
    it(`rejects: ${name}`, () => {
      const auth = createAuthenticator();
      rejects(
        () => verifyAssertion(stored(auth), makeAssertion(auth, ceremony('get'), o)),
        status,
        code,
      );
    });
  }

  it('rejects a counter that does not increase (cloned authenticator)', () => {
    const auth = createAuthenticator();
    for (const next of [7, 3]) {
      rejects(
        () =>
          verifyAssertion(
            stored(auth, 7),
            makeAssertion(auth, ceremony('get'), { signCount: next }),
          ),
        401,
        'counter_regressed',
      );
    }
    rejects(
      () =>
        verifyAssertion(stored(auth, 7), makeAssertion(auth, ceremony('get'), { signCount: 0 })),
      401,
      'counter_regressed',
    );
  });

  it('rejects a tampered signature, authenticatorData or clientData', () => {
    const auth = createAuthenticator();
    const flip = (b64: string, at: number) => {
      const buf = Buffer.from(b64, 'base64url');
      buf[at] ^= 0x01;
      return buf.toString('base64url');
    };
    const sig = makeAssertion(auth, ceremony('get'));
    rejects(
      () => verifyAssertion(stored(auth), { ...sig, signature: flip(sig.signature, 20) }),
      401,
      'signature_invalid',
    );
    // Bump the counter byte: still well-formed, but no longer what was signed.
    const ad = makeAssertion(auth, ceremony('get'));
    rejects(
      () =>
        verifyAssertion(stored(auth), { ...ad, authenticatorData: flip(ad.authenticatorData, 36) }),
      401,
      'signature_invalid',
    );
  });

  it('rejects malformed clientDataJSON and short authenticatorData', () => {
    const auth = createAuthenticator();
    const a = makeAssertion(auth, ceremony('get'));
    rejects(
      () =>
        verifyAssertion(stored(auth), {
          ...a,
          clientDataJSON: Buffer.from('{nope').toString('base64url'),
        }),
      400,
      'client_data_invalid',
    );
    const b = makeAssertion(auth, ceremony('get'));
    rejects(
      () =>
        verifyAssertion(stored(auth), {
          ...b,
          authenticatorData: Buffer.alloc(36).toString('base64url'),
        }),
      400,
      'auth_data_invalid',
    );
  });
});

describe('auth/webauthn — registration', () => {
  it('stores a credential for the member that requested the challenge', () => {
    const auth = createAuthenticator();
    const cred = verifyRegistration(
      'm4',
      makeRegistration(auth, ceremony('create', 'm4'), { label: 'Laptop' }),
    );
    assert.equal(cred.id, auth.credentialId);
    assert.equal(cred.publicKey, auth.publicKey);
    assert.equal(cred.algorithm, -7);
    assert.equal(cred.label, 'Laptop');
    // The stored key verifies later assertions.
    assert.equal(verifyAssertion(cred, makeAssertion(auth, ceremony('get'))), 1);
  });

  it('refuses a challenge issued to another member', () => {
    const auth = createAuthenticator();
    rejects(
      () => verifyRegistration('m4', makeRegistration(auth, ceremony('create', 'm5'))),
      400,
      'challenge_invalid',
    );
  });

  it('refuses a get challenge, a get ceremony type and unsupported algorithms', () => {
    const auth = createAuthenticator();
    rejects(
      () => verifyRegistration('m4', makeRegistration(auth, ceremony('get'))),
      400,
      'challenge_invalid',
    );
    rejects(
      () =>
        verifyRegistration(
          'm4',
          makeRegistration(auth, ceremony('create', 'm4'), { type: 'webauthn.get' }),
        ),
      400,
      'client_data_invalid',
    );
    rejects(
      () =>
        verifyRegistration(
          'm4',
          makeRegistration(auth, ceremony('create', 'm4'), { algorithm: -8 }),
        ),
      400,
      'alg_unsupported',
    );
    rejects(
      () =>
        verifyRegistration(
          'm4',
          makeRegistration(auth, ceremony('create', 'm4'), { flags: FLAG_UP }),
        ),
      400,
      'user_not_verified',
    );
  });

  // FINDING B-4 (auth/webauthn.ts:119): an unparsable publicKey makes
  // createPublicKey throw a plain Error, which the router reports as
  // 500 "internal" (and logs) instead of a 400 the client can act on.
  it(
    'refuses a public key that does not parse with a 400, not an unexpected error',
    { todo: 'FINDING B-4: garbage publicKey escapes as a non-HttpError (500)' },
    () => {
      const auth = createAuthenticator();
      const body = makeRegistration(auth, ceremony('create', 'm4'), {
        publicKey: Buffer.from('not a key').toString('base64url'),
      });
      // Any 400 code is acceptable; what matters is a client error, not a 500.
      assert.throws(
        () => verifyRegistration('m4', body),
        (e: unknown) => e instanceof HttpError && e.status === 400,
      );
    },
  );
});
