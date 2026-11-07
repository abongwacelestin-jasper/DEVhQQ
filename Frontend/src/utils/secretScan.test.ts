import { describe, expect, it } from 'vitest';
import { scanForSecrets } from './secretScan';

// Assembled at runtime so this file never contains a literal that scanners flag.
const fake = {
  stripe: ['sk', 'live', 'abcdEFGH12345678'].join('_'),
  aws: `AKIA${'ABCDEFGHIJKLMNOP'}`,
  github: `ghp_${'a1B2c3D4e5F6g7H8'}`,
  slack: `xoxb-${'1234567890-abcdef'}`,
  key: `-----BEGIN RSA ${'PRIVATE'} KEY-----`,
};

describe('scanForSecrets', () => {
  it('finds each rule with file, 1-based line and rule name', () => {
    const content = [
      'const ok = 1;',
      `const stripe = "${fake.stripe}";`,
      `aws = ${fake.aws}`,
      `token: ${fake.github}`,
      `SLACK=${fake.slack}`,
      fake.key,
      `const password = "hunter2hunter2";`,
    ].join('\n');
    const found = scanForSecrets([{ path: 'src/config.ts', content }]);
    expect(found.map((f) => [f.line, f.rule])).toEqual([
      [2, 'Stripe live secret key'],
      [3, 'AWS access key ID'],
      [4, 'GitHub personal access token'],
      [5, 'Slack token'],
      [6, 'Private key block'],
      [7, 'Hard-coded password'],
    ]);
    expect(found.every((f) => f.file === 'src/config.ts')).toBe(true);
  });

  it('never echoes the full secret in the preview', () => {
    const found = scanForSecrets([{ path: 'a', content: fake.stripe }]);
    expect(found).toHaveLength(1);
    const { preview } = found[0];
    expect(preview).not.toContain(fake.stripe);
    expect(preview.startsWith(fake.stripe.slice(0, 4))).toBe(true);
    expect(preview.endsWith(fake.stripe.slice(-2))).toBe(true);
    expect(preview).toContain('•');
  });

  it('ignores test keys, short values and clean files', () => {
    const content = [
      ['sk', 'test', 'abcdEFGH12345678'].join('_'),
      'password = "short"',
      'const pw = process.env.PASSWORD;',
    ].join('\n');
    expect(scanForSecrets([{ path: 'b', content }])).toEqual([]);
    expect(scanForSecrets([])).toEqual([]);
  });

  it('scans every file independently', () => {
    const found = scanForSecrets([
      { path: 'one.ts', content: fake.aws },
      { path: 'two.ts', content: `\n\n${fake.github}` },
    ]);
    expect(found.map((f) => `${f.file}:${f.line}`)).toEqual(['one.ts:1', 'two.ts:3']);
  });
});
