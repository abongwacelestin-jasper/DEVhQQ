export interface SecretFinding {
  file: string;
  line: number;
  rule: string;
  preview: string;
}

const rules: { rule: string; re: RegExp }[] = [
  { rule: 'Stripe live secret key', re: /sk_live_[A-Za-z0-9]{8,}/ },
  { rule: 'AWS access key ID', re: /AKIA[0-9A-Z]{12,}/ },
  { rule: 'GitHub personal access token', re: /ghp_[A-Za-z0-9]{12,}/ },
  { rule: 'Slack token', re: /xox[bpas]-[A-Za-z0-9-]{10,}/ },
  { rule: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { rule: 'Hard-coded password', re: /(password|passwd|secret)\s*[:=]\s*['"][^'"]{6,}['"]/i },
];

/** Pre-commit secret scan, run in the browser before anything leaves the editor. */
export function scanForSecrets(files: { path: string; content: string }[]): SecretFinding[] {
  const out: SecretFinding[] = [];
  files.forEach((f) =>
    f.content.split('\n').forEach((line, i) => {
      rules.forEach((r) => {
        const m = line.match(r.re);
        if (m) out.push({ file: f.path, line: i + 1, rule: r.rule, preview: mask(m[0]) });
      });
    }),
  );
  return out;
}

function mask(s: string) {
  if (s.length <= 8) return '••••••';
  return `${s.slice(0, 4)}${'•'.repeat(Math.min(12, s.length - 6))}${s.slice(-2)}`;
}
