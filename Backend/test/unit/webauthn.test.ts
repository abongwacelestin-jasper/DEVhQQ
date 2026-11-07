import '../setup.ts';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { config } from '../../config/env.ts';
import {
  CHALLENGE_TTL_MS,
  isSuspended,
  issueAssertionChallenge,
  issueRegistrationChallenge,
  takeChallenge,
  verifyAssertion,
  verifyRegistration,
  type StoredPasskey,
} from '../../auth/webauthn.ts';
import { HttpError, type PasskeyCredential } from '../../types.ts';
import {
  FLAG_AT,
  FLAG_UP,
  FLAG_UV,
  cbor,
  coseKey,
  createAuthenticator,
  makeAssertion,
  makeRegistration,
  type Alg,
  type AssertionOverrides,
  type Ceremony,
  type SoftAuthenticator,
} from '../helpers/webauthn.ts';

const ORIGIN = config.appOrigin;
const RP_ID = config.rpId;
const MEMBER = {
  id: 'm4',
  email: 'kofi@techorg.io',
  name: 'Kofi',
  passkeys: [] as PasskeyCredential[],
};

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

function getCeremony(
  purpose: 'sign-in' | 'mfa' | 'step-up' = 'sign-in',
  sessionId = 's1',
): Ceremony {
  const c =
    purpose === 'sign-in'
      ? issueAssertionChallenge('sign-in')
      : issueAssertionChallenge(purpose, MEMBER, sessionId);
  return {
    challengeId: c.challengeId,
    challenge: c.publicKey.challenge,
    rpId: RP_ID,
    origin: ORIGIN,
  };
}

function createCeremony(sessionId = 's1', memberId = MEMBER.id): Ceremony {
  const c = issueRegistrationChallenge({ ...MEMBER, id: memberId }, sessionId);
  return {
    challengeId: c.challengeId,
    challenge: c.publicKey.challenge,
    rpId: RP_ID,
    origin: ORIGIN,
  };
}

/** Takes the challenge and verifies, like the route does. */
function assertWith(
  auth: SoftAuthenticator,
  cred: PasskeyCredential,
  ceremony: Ceremony,
  o: AssertionOverrides = {},
  owner = MEMBER.id,
) {
  const body = makeAssertion(auth, ceremony, o);
  const challenge = takeChallenge(body.challengeId, 'get');
  return verifyAssertion(cred, owner, challenge, body);
}

function rejects(fn: () => unknown, status: number, code: string) {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof HttpError, `HttpError expected, got ${String(e)}`);
    assert.equal(e.status, status, e.message);
    assert.equal(e.code, code);
    return true;
  });
}

describe('auth/webauthn — challenges', () => {
  it('sign-in challenges are random and reveal no credentials', () => {
    const a = issueAssertionChallenge('sign-in');
    const b = issueAssertionChallenge('sign-in');
    assert.notEqual(a.challengeId, b.challengeId);
    assert.notEqual(a.publicKey.challenge, b.publicKey.challenge);
    assert.equal(Buffer.from(a.publicKey.challenge, 'base64url').length, 32);
    assert.equal(a.publicKey.rpId, RP_ID);
    assert.equal(a.publicKey.userVerification, 'required');
    assert.deepEqual(a.publicKey.allowCredentials, []);
  });

  it('mfa/step-up challenges need a member and session and list only unsuspended keys', () => {
    assert.throws(
      () => issueAssertionChallenge('mfa'),
      (e: unknown) => e instanceof HttpError && e.status === 401,
    );
    const ok = createAuthenticator();
    const bad = createAuthenticator();
    const member = {
      id: 'm9',
      passkeys: [
        stored(ok),
        { ...stored(bad), suspendedAt: new Date().toISOString() } as StoredPasskey,
      ],
    };
    const c = issueAssertionChallenge('step-up', member, 'sess');
    assert.deepEqual(
      c.publicKey.allowCredentials.map((d) => d.id),
      [ok.credentialId],
    );
  });

  it('registration options carry the RP, user handle, allowed algorithms and exclusions', () => {
    const existing = createAuthenticator();
    const c = issueRegistrationChallenge({ ...MEMBER, passkeys: [stored(existing)] }, 's1');
    assert.equal(c.publicKey.rp.id, RP_ID);
    assert.equal(c.publicKey.user.id, Buffer.from('m4').toString('base64url'));
    assert.deepEqual(
      c.publicKey.pubKeyCredParams.map((p) => p.alg),
      config.crypto.webauthnAlgorithms,
    );
    assert.deepEqual(
      c.publicKey.excludeCredentials.map((d) => d.id),
      [existing.credentialId],
    );
    assert.equal(c.publicKey.authenticatorSelection.userVerification, 'required');
  });

  it('a challenge is single use, even when verification fails', () => {
    const auth = createAuthenticator();
    const c = getCeremony();
    rejects(
      () => assertWith(auth, stored(auth), c, { origin: 'https://evil.example' }),
      400,
      'origin_mismatch',
    );
    rejects(() => takeChallenge(c.challengeId, 'get'), 400, 'challenge_invalid');
  });

  it('kinds cannot be swapped: create ↔ get', () => {
    rejects(() => takeChallenge(createCeremony().challengeId, 'get'), 400, 'challenge_invalid');
    rejects(() => takeChallenge(getCeremony().challengeId, 'create'), 400, 'challenge_invalid');
    rejects(() => takeChallenge('unknown', 'get'), 400, 'challenge_invalid');
  });

  it('expires after CHALLENGE_TTL_MS (fake time)', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
    const auth = createAuthenticator();
    const ok = getCeremony();
    t.mock.timers.tick(CHALLENGE_TTL_MS);
    assert.deepEqual(
      assertWith(auth, stored(auth), ok),
      { ok: true, signCount: 1 },
      'valid at TTL',
    );
    const late = getCeremony();
    t.mock.timers.tick(CHALLENGE_TTL_MS + 1);
    rejects(() => takeChallenge(late.challengeId, 'get'), 400, 'challenge_invalid');
  });
});

describe('auth/webauthn — assertions with real keys', () => {
  const restoreAlgs = [...config.crypto.webauthnAlgorithms];
  afterEach(() => {
    config.crypto.webauthnAlgorithms = [...restoreAlgs];
  });

  for (const alg of [-7, -257, -8] as Alg[]) {
    it(`verifies a genuine ${alg === -7 ? 'ES256' : alg === -8 ? 'EdDSA' : 'RS256'} assertion and returns the new counter`, () => {
      if (!config.crypto.webauthnAlgorithms.includes(alg))
        config.crypto.webauthnAlgorithms.push(alg);
      const auth = createAuthenticator(alg);
      assert.deepEqual(assertWith(auth, stored(auth, 4), getCeremony(), { signCount: 5 }), {
        ok: true,
        signCount: 5,
      });
    });
  }

  it('refuses an algorithm that is no longer allowed at use time', () => {
    const auth = createAuthenticator(-8);
    rejects(() => assertWith(auth, stored(auth), getCeremony()), 400, 'alg_unsupported');
  });

  it('accepts authenticators that never increment (0 → 0)', () => {
    const auth = createAuthenticator();
    assert.deepEqual(assertWith(auth, stored(auth, 0), getCeremony(), { signCount: 0 }), {
      ok: true,
      signCount: 0,
    });
  });

  it('reports (does not throw) a sign-count regression, after the signature check', () => {
    const auth = createAuthenticator();
    for (const next of [7, 3, 0])
      assert.deepEqual(assertWith(auth, stored(auth, 7), getCeremony(), { signCount: next }), {
        ok: false,
        reason: 'counter_regressed',
        signCount: next,
      });
    // An unsigned (forged) low counter must never be able to trigger suspension.
    const attacker = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    rejects(
      () => assertWith(auth, stored(auth, 7), getCeremony(), { signCount: 1, signWith: attacker }),
      401,
      'signature_invalid',
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
    [
      'user handle of another member',
      { userHandle: Buffer.from('m1').toString('base64url') },
      401,
      'invalid_credentials',
    ],
  ];
  for (const [name, o, status, code] of cases) {
    it(`rejects: ${name}`, () => {
      const auth = createAuthenticator();
      rejects(() => assertWith(auth, stored(auth), getCeremony(), o), status, code);
    });
  }

  it('accepts the owner’s user handle', () => {
    const auth = createAuthenticator();
    const r = assertWith(auth, stored(auth), getCeremony(), {
      userHandle: Buffer.from('m4').toString('base64url'),
    });
    assert.equal(r.ok, true);
  });

  it('a member-bound challenge cannot be answered with another member’s passkey', () => {
    const auth = createAuthenticator();
    rejects(
      () => assertWith(auth, stored(auth), getCeremony('mfa'), {}, 'm5'),
      401,
      'invalid_credentials',
    );
  });

  it('refuses suspended credentials', () => {
    const auth = createAuthenticator();
    const cred = { ...stored(auth), suspendedAt: new Date().toISOString() } as StoredPasskey;
    assert.equal(isSuspended(cred), true);
    assert.equal(isSuspended(stored(auth)), false);
    rejects(() => assertWith(auth, cred, getCeremony()), 401, 'credential_suspended');
  });

  it('rejects tampered signature, authenticatorData, malformed DER and short data', () => {
    const auth = createAuthenticator();
    const flip = (b64: string, at: number) => {
      const buf = Buffer.from(b64, 'base64url');
      buf[at] ^= 0x01;
      return buf.toString('base64url');
    };
    const run = (
      mut: (b: ReturnType<typeof makeAssertion>) => ReturnType<typeof makeAssertion>,
    ) => {
      const body = mut(makeAssertion(auth, getCeremony()));
      return verifyAssertion(stored(auth), 'm4', takeChallenge(body.challengeId, 'get'), body);
    };
    rejects(
      () => run((b) => ({ ...b, signature: flip(b.signature, 20) })),
      401,
      'signature_invalid',
    );
    rejects(
      () => run((b) => ({ ...b, signature: randomBytes(10).toString('base64url') })),
      401,
      'signature_invalid',
    );
    rejects(
      () => run((b) => ({ ...b, authenticatorData: flip(b.authenticatorData, 36) })),
      401,
      'signature_invalid',
    );
    rejects(
      () => run((b) => ({ ...b, clientDataJSON: Buffer.from('{nope').toString('base64url') })),
      400,
      'client_data_invalid',
    );
    rejects(
      () => run((b) => ({ ...b, authenticatorData: Buffer.alloc(36).toString('base64url') })),
      400,
      'auth_data_invalid',
    );
  });

  it('a stored key that does not fit its algorithm is refused', () => {
    const rsa = createAuthenticator(-257);
    const cred = { ...stored(rsa), algorithm: -7 };
    rejects(() => assertWith(rsa, cred, getCeremony()), 400, 'alg_unsupported');
  });
});

describe('auth/webauthn — registration', () => {
  it('stores a credential that later verifies assertions (ES256 and RS256)', () => {
    for (const alg of [-7, -257] as Alg[]) {
      const auth = createAuthenticator(alg);
      const cred = verifyRegistration(
        'm4',
        's1',
        makeRegistration(auth, createCeremony(), { label: 'Laptop' }),
      );
      assert.deepEqual(
        { id: cred.id, publicKey: cred.publicKey, algorithm: cred.algorithm, label: cred.label },
        { id: auth.credentialId, publicKey: auth.publicKey, algorithm: alg, label: 'Laptop' },
      );
      assert.equal(assertWith(auth, cred, getCeremony()).ok, true);
    }
  });

  it('is bound to the member and the session that asked', () => {
    const auth = createAuthenticator();
    rejects(
      () => verifyRegistration('m4', 's1', makeRegistration(auth, createCeremony('s1', 'm5'))),
      400,
      'challenge_invalid',
    );
    rejects(
      () => verifyRegistration('m4', 's1', makeRegistration(auth, createCeremony('other'))),
      400,
      'challenge_invalid',
    );
  });

  it('refuses the wrong ceremony type, missing UV and missing attested data', () => {
    const auth = createAuthenticator();
    rejects(
      () =>
        verifyRegistration(
          'm4',
          's1',
          makeRegistration(auth, createCeremony(), { type: 'webauthn.get' }),
        ),
      400,
      'client_data_invalid',
    );
    rejects(
      () =>
        verifyRegistration(
          'm4',
          's1',
          makeRegistration(auth, createCeremony(), { flags: FLAG_UP | FLAG_AT }),
        ),
      400,
      'user_not_verified',
    );
    rejects(
      () =>
        verifyRegistration(
          'm4',
          's1',
          makeRegistration(auth, createCeremony(), { flags: FLAG_UP | FLAG_UV }),
        ),
      400,
      'auth_data_invalid',
    );
  });

  it('refuses unsupported algorithms and keys that do not fit the declared algorithm', () => {
    const auth = createAuthenticator();
    rejects(
      () =>
        verifyRegistration('m4', 's1', makeRegistration(auth, createCeremony(), { algorithm: -8 })),
      400,
      'alg_unsupported',
    );
    const rsa = createAuthenticator(-257);
    // An RSA SPKI claiming ES256.
    rejects(
      () =>
        verifyRegistration(
          'm4',
          's1',
          makeRegistration(auth, createCeremony(), { publicKey: rsa.publicKey }),
        ),
      400,
      'alg_unsupported',
    );
  });

  it('the SPKI must be the same key as the COSE key in authenticatorData', () => {
    const auth = createAuthenticator();
    const other = createAuthenticator();
    rejects(
      () =>
        verifyRegistration(
          'm4',
          's1',
          makeRegistration(auth, createCeremony(), { publicKey: other.publicKey }),
        ),
      400,
      'key_mismatch',
    );
    rejects(
      () =>
        verifyRegistration(
          'm4',
          's1',
          makeRegistration(auth, createCeremony(), { cose: coseKey(auth, -257) }),
        ),
      400,
      'alg_mismatch',
    );
  });

  it('the reported credential id must equal the embedded one, with sane length', () => {
    const auth = createAuthenticator();
    rejects(
      () =>
        verifyRegistration(
          'm4',
          's1',
          makeRegistration(auth, createCeremony(), { embeddedCredentialId: randomBytes(16) }),
        ),
      400,
      'credential_mismatch',
    );
    rejects(
      () =>
        verifyRegistration(
          'm4',
          's1',
          makeRegistration(auth, createCeremony(), { embeddedCredentialId: randomBytes(8) }),
        ),
      400,
      'auth_data_invalid',
    );
  });

  it('malformed CBOR and unparsable public keys are 400s, not 500s (B-4 fixed)', () => {
    const auth = createAuthenticator();
    for (const cose of [
      Buffer.from([0xff]),
      Buffer.from([0xa1]),
      cbor(5),
      Buffer.from([0xc6, 0x01]),
    ])
      rejects(
        () => verifyRegistration('m4', 's1', makeRegistration(auth, createCeremony(), { cose })),
        400,
        'auth_data_invalid',
      );
    rejects(
      () =>
        verifyRegistration(
          'm4',
          's1',
          makeRegistration(auth, createCeremony(), {
            publicKey: Buffer.from('not a key').toString('base64url'),
          }),
        ),
      400,
      'key_invalid',
    );
  });
});
