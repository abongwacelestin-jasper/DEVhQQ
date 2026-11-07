export type SnippetKind =
  'curl' | 'httpie' | 'fetch' | 'axios' | 'python' | 'go' | 'powershell' | 'wget' | 'http';

export const snippetKinds: { id: SnippetKind; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'httpie', label: 'HTTPie' },
  { id: 'fetch', label: 'fetch' },
  { id: 'axios', label: 'axios' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'wget', label: 'wget' },
  { id: 'http', label: 'Raw HTTP' },
];

interface SnippetInput {
  method: string;
  origin: string;
  url: string;
  body: string;
  headers: [string, string][];
  token: string | null;
  includeToken: boolean;
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const dq = (s: string) => JSON.stringify(s);

/** Generates a copy-ready request in the chosen client. Uses $DEVHQ_TOKEN unless the live token is opted in. */
/** JSON → Python literals, leaving the words true/false/null inside strings alone (F-FE-2). */
function toPythonLiterals(json: string): string {
  const py: Record<string, string> = { true: 'True', false: 'False', null: 'None' };
  return json.replace(/"(?:[^"\\]|\\.)*"|\b(true|false|null)\b/g, (m, word?: string) =>
    word ? py[word] : m,
  );
}

/** PowerShell single-quoted string: a quote is escaped by doubling it (F-FE-3). */
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function buildSnippet(kind: SnippetKind, i: SnippetInput): string {
  const full = i.origin.replace(/\/$/, '') + i.url;
  const tok = i.includeToken && i.token ? i.token : null;
  let compact = '';
  let pretty = '';
  if (i.body.trim()) {
    try {
      const parsed: unknown = JSON.parse(i.body);
      compact = JSON.stringify(parsed);
      pretty = JSON.stringify(parsed, null, 2);
    } catch {
      compact = pretty = i.body.trim();
    }
  }
  const extra = i.headers.filter(([k]) => k);
  const authShell = tok
    ? sq(`Authorization: Bearer ${tok}`)
    : '"Authorization: Bearer $DEVHQ_TOKEN"';

  switch (kind) {
    case 'curl':
      return [
        `curl -sS -X ${i.method} ${sq(full)}`,
        `  -H ${authShell}`,
        ...(compact ? [`  -H 'Content-Type: application/json'`] : []),
        ...extra.map(([k, v]) => `  -H ${sq(`${k}: ${v}`)}`),
        ...(compact ? [`  --data-raw ${sq(compact)}`] : []),
      ].join(' \\\n');
    case 'httpie':
      return [
        `http ${i.method} ${sq(full)}`,
        `  ${tok ? sq(`Authorization:Bearer ${tok}`) : '"Authorization:Bearer $DEVHQ_TOKEN"'}`,
        ...extra.map(([k, v]) => `  ${sq(`${k}:${v}`)}`),
        ...(compact ? [`  --raw ${sq(compact)}`] : []),
      ].join(' \\\n');
    case 'fetch': {
      const h = [
        `    Authorization: ${tok ? dq(`Bearer ${tok}`) : '`Bearer ${process.env.DEVHQ_TOKEN}`'},`,
        ...(compact ? [`    'Content-Type': 'application/json',`] : []),
        ...extra.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`),
      ];
      return `const res = await fetch(${dq(full)}, {\n  method: ${dq(i.method)},\n  headers: {\n${h.join('\n')}\n  },${compact ? `\n  body: JSON.stringify(${pretty.replace(/\n/g, '\n  ')}),` : ''}\n});\nconsole.log(res.status, await res.json());`;
    }
    case 'axios': {
      const h = [
        `    Authorization: ${tok ? dq(`Bearer ${tok}`) : '`Bearer ${process.env.DEVHQ_TOKEN}`'},`,
        ...extra.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`),
      ];
      return `import axios from 'axios';\n\nconst { status, data } = await axios({\n  method: ${dq(i.method.toLowerCase())},\n  url: ${dq(full)},\n  headers: {\n${h.join('\n')}\n  },${compact ? `\n  data: ${pretty.replace(/\n/g, '\n  ')},` : ''}\n  validateStatus: () => true,\n});\nconsole.log(status, data);`;
    }
    case 'python':
      return `import os, requests\n\nres = requests.request(\n    ${dq(i.method)},\n    ${dq(full)},\n    headers={\n        "Authorization": ${tok ? dq(`Bearer ${tok}`) : `f"Bearer {os.environ['DEVHQ_TOKEN']}"`},\n${extra.map(([k, v]) => `        ${dq(k)}: ${dq(v)},`).join('\n')}${extra.length ? '\n' : ''}    },${
        compact ? `\n    json=${toPythonLiterals(pretty).replace(/\n/g, '\n    ')},` : ''
      }\n    timeout=10,\n)\nprint(res.status_code, res.json())`;
    case 'go':
      return `package main\n\nimport (\n\t"fmt"\n\t"io"\n\t"net/http"\n\t"os"${compact ? '\n\t"strings"' : ''}\n)\n\nfunc main() {\n\treq, _ := http.NewRequest(${dq(i.method)}, ${dq(full)}, ${compact ? `strings.NewReader(${dq(compact)})` : 'nil'})\n\treq.Header.Set("Authorization", ${tok ? dq(`Bearer ${tok}`) : '"Bearer "+os.Getenv("DEVHQ_TOKEN")'})${compact ? '\n\treq.Header.Set("Content-Type", "application/json")' : ''}${extra.map(([k, v]) => `\n\treq.Header.Set(${dq(k)}, ${dq(v)})`).join('')}\n\tres, err := http.DefaultClient.Do(req)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tdefer res.Body.Close()\n\tbody, _ := io.ReadAll(res.Body)\n\tfmt.Println(res.StatusCode, string(body))\n}`;
    case 'powershell':
      return `$headers = @{\n  "Authorization" = ${tok ? dq(`Bearer ${tok}`) : '"Bearer $env:DEVHQ_TOKEN"'}\n${extra.map(([k, v]) => `  ${dq(k)} = ${dq(v)}`).join('\n')}${extra.length ? '\n' : ''}}\n${compact ? `$body = @'\n${pretty}\n'@\n` : ''}Invoke-RestMethod -Method ${i.method} -Uri ${psq(full)} -Headers $headers${compact ? " -ContentType 'application/json' -Body $body" : ''}`;
    case 'wget':
      return [
        `wget -qO- --method=${i.method}`,
        `  --header=${authShell}`,
        ...(compact
          ? [`  --header='Content-Type: application/json'`, `  --body-data=${sq(compact)}`]
          : []),
        ...extra.map(([k, v]) => `  --header=${sq(`${k}: ${v}`)}`),
        `  ${sq(full)}`,
      ].join(' \\\n');
    case 'http': {
      const host = (() => {
        try {
          return new URL(i.origin).host;
        } catch {
          return 'localhost:8080';
        }
      })();
      return `${i.method} ${i.url} HTTP/1.1\nHost: ${host}\nAuthorization: Bearer ${tok ?? '<token>'}\n${extra.map(([k, v]) => `${k}: ${v}\n`).join('')}${compact ? `Content-Type: application/json\nContent-Length: ${new Blob([compact]).size}\n\n${compact}` : ''}`;
    }
  }
}
