import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem } from '../../security/passwordPolicy.ts';
import { passwordProblem as collabCopy } from '../../domain/collab/passwordPolicy.ts';
import { rng } from '../helpers/random.ts';

const EMAIL = 'ada.lovelace@example.com';

describe('security/passwordPolicy — rules', () => {
  const cases: [string, string | null][] = [
    ['Short1!a', 'Use at least 12 characters.'],
    ['Abcdefgh1!x', 'Use at least 12 characters.'], // 11
    ['abcdefgh1!xy', 'Include both upper and lower case letters.'],
    ['ABCDEFGH1!XY', 'Include both upper and lower case letters.'],
    ['Abcdefghij!x', 'Include at least one number.'],
    ['Abcdefghij1x', 'Include at least one symbol.'],
    ['Abcdefghi1 x', null], // a space counts as a symbol
    ['Abcdefgh1!xy', null], // exactly 12
    ['Correct-Horse-42!', null],
    ['My-ada.lovelace-1', 'Do not include the name from your email address.'],
    ['My-ADA.LOVELACE-1', 'Do not include the name from your email address.'],
  ];
  for (const [pw, expected] of cases)
    it(`${JSON.stringify(pw)} → ${expected ?? 'ok'}`, () =>
      assert.equal(passwordProblem(pw, EMAIL), expected));

  it('reports the first failing rule in a fixed order', () => {
    assert.equal(passwordProblem('a', EMAIL), 'Use at least 12 characters.');
    assert.equal(
      passwordProblem('aaaaaaaaaaaa', EMAIL),
      'Include both upper and lower case letters.',
    );
  });

  it('ignores email local parts shorter than 3 characters', () => {
    assert.equal(passwordProblem('Xx-Correct-42!', 'xx@example.com'), null);
    assert.equal(
      passwordProblem('Bob-Correct-42!', 'bob@example.com'),
      'Do not include the name from your email address.',
    );
  });
});

describe('security/passwordPolicy — properties', () => {
  const r = rng(11);
  const pools = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digit: '0123456789',
    symbol: '!@#$%^&*()-_=+[]{};:,.<>/? ',
  };
  const all = Object.values(pools).join('');
  const randomPassword = () =>
    Array.from({ length: r.int(0, 24) }, () => all[r.int(0, all.length - 1)]).join('');

  it('accepts exactly the passwords meeting every rule (independent oracle)', () => {
    for (let i = 0; i < 2000; i++) {
      const pw = randomPassword();
      const ok =
        pw.length >= 12 &&
        /[a-z]/.test(pw) &&
        /[A-Z]/.test(pw) &&
        /[0-9]/.test(pw) &&
        /[^A-Za-z0-9]/.test(pw) &&
        !pw.toLowerCase().includes('zq9');
      assert.equal(passwordProblem(pw, 'zq9@example.com') === null, ok, JSON.stringify(pw));
    }
  });

  it('the collab copy (recovery) agrees with the shared policy on every input', () => {
    for (let i = 0; i < 2000; i++) {
      const pw = randomPassword();
      const email = `${
        randomPassword()
          .replace(/[^a-z]/g, '')
          .slice(0, 6) || 'abc'
      }@example.com`;
      assert.equal(collabCopy(pw, email), passwordProblem(pw, email), `${pw} / ${email}`);
    }
  });
});
