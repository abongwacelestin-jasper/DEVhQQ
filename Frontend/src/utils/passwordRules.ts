/**
 * Client-side checklist mirroring `Backend/security/passwordPolicy.ts`. The
 * server stays the authority; this only explains the rules as the user types.
 */
export interface PasswordRule {
  label: string;
  ok: boolean;
}

export function passwordRules(pw: string, email: string): PasswordRule[] {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return [
    { label: 'At least 12 characters', ok: pw.length >= 12 },
    { label: 'Upper and lower case letters', ok: /[a-z]/.test(pw) && /[A-Z]/.test(pw) },
    { label: 'At least one number', ok: /\d/.test(pw) },
    { label: 'At least one symbol', ok: /[^A-Za-z0-9]/.test(pw) },
    {
      label: 'Doesn’t contain your email name',
      ok: !!pw && (local.length < 3 || !pw.toLowerCase().includes(local)),
    },
  ];
}

export function strengthOf(rules: PasswordRule[]) {
  const score = rules.filter((r) => r.ok).length;
  if (score <= 2) return { score, label: 'Weak', cls: 'bg-bad', text: 'text-bad' };
  if (score < rules.length) return { score, label: 'Fair', cls: 'bg-warn', text: 'text-warn' };
  return { score, label: 'Strong', cls: 'bg-ok', text: 'text-ok' };
}
