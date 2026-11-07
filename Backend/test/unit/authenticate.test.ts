import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  readToken,
  sessionCookie,
} from '../../middleware/authenticate.ts';

describe('middleware/authenticate — token transport', () => {
  it('prefers the Authorization bearer over the cookie', () => {
    assert.equal(readToken(`${SESSION_COOKIE}=fromcookie`, 'Bearer fromheader'), 'fromheader');
    assert.equal(readToken(undefined, 'Bearer   padded  '), 'padded');
  });

  it('reads the __Host- cookie among others and URL-decodes it', () => {
    const header = `theme=dark; ${SESSION_COOKIE}=a%2Eb%3D; other=1`;
    assert.equal(readToken(header, undefined), 'a.b=');
  });

  it('ignores look-alike cookies and non-bearer schemes', () => {
    assert.equal(readToken(`x${SESSION_COOKIE}=nope; devhq_session=nope`, undefined), undefined);
    assert.equal(readToken(undefined, 'Basic dXNlcjpwYXNz'), undefined);
    assert.equal(readToken(undefined, 'bearer lowercase'), undefined);
    assert.equal(readToken(undefined, undefined), undefined);
  });

  it('issues and clears the cookie with every hardening attribute', () => {
    assert.equal(
      sessionCookie('tok.en', 60),
      `${SESSION_COOKIE}=tok.en; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=60`,
    );
    assert.equal(sessionCookie('a b', 1).split(';')[0], `${SESSION_COOKIE}=a%20b`);
    assert.match(
      clearSessionCookie(),
      /^__Host-devhq_session=; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=0$/,
    );
  });
});
