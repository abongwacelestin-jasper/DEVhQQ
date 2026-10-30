/**
 * Stand-in documents for the simulated transport. A real codespace's web_url is served by
 * GitHub; in the preview there is no codespace, so the panes render these clearly-labelled
 * stand-ins instead of a broken frame.
 */
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function simulatedEditorDoc(repo: string, ref: string, name: string) {
  const files = [
    'src/',
    '  index.ts',
    '  billing/',
    '    retry.ts',
    '    webhooks.ts',
    'package.json',
    'tsconfig.json',
    'README.md',
  ];
  const code = [
    "import { backoff } from './backoff';",
    '',
    'export async function retryPayment(id: string) {',
    '  for (const wait of backoff({ base: 500, max: 5 })) {',
    '    const res = await charge(id);',
    '    if (res.ok) return res;',
    '    await sleep(wait);',
    '  }',
    "  throw new Error('payment failed after retries');",
    '}',
  ];

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;height:100vh;display:grid;grid-template-rows:30px 1fr 22px;font:12px/1.55 ui-monospace,Menlo,monospace;background:#1e1e1e;color:#d4d4d4}
  .bar{display:flex;align-items:center;gap:8px;padding:0 10px;background:#323233;color:#ccc;font:12px system-ui}
  .tag{background:#0e639c;color:#fff;border-radius:3px;padding:1px 6px;font-size:11px}
  .main{display:grid;grid-template-columns:48px 190px 1fr;min-height:0}
  .act{background:#333}.side{background:#252526;padding:8px 10px;white-space:pre;color:#bbb;overflow:auto}
  .ed{padding:10px 0;overflow:auto;white-space:pre}.ln{display:inline-block;width:40px;text-align:right;color:#6e7681;padding-right:14px}
  .k{color:#569cd6}.s{color:#ce9178}.f{color:#dcdcaa}
  .status{display:flex;gap:14px;align-items:center;padding:0 10px;background:#007acc;color:#fff;font:11px system-ui}
  @media (max-width:560px){.main{grid-template-columns:0 0 1fr}.side,.act{display:none}}
  </style></head><body>
  <div class="bar"><b>Codespaces</b><span>${esc(repo)}</span><span class="tag">Simulated</span></div>
  <div class="main"><div class="act"></div><div class="side">EXPLORER\n\n${files.map(esc).join('\n')}</div>
  <div class="ed">${code
    .map(
      (l, i) =>
        `<span class="ln">${i + 1}</span>${esc(l)
          .replace(
            /\b(import|from|export|async|function|for|const|of|await|if|return|throw|new)\b/g,
            '<span class="k">$1</span>',
          )
          .replace(/('[^']*')/g, '<span class="s">$1</span>')}`,
    )
    .join('\n')}</div></div>
  <div class="status"><span>⎇ ${esc(ref)}</span><span>${esc(name)}</span><span style="margin-left:auto">Connect the DevHQ API to open the real VS Code editor</span></div>
  </body></html>`;
}

export function simulatedPreviewDoc(port: number) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font:14px system-ui;background:#fafafa;color:#18181b}
  .card{max-width:320px;padding:24px;border:1px solid #e4e4e7;border-radius:10px;background:#fff;text-align:center}
  code{background:#f4f4f5;border-radius:4px;padding:1px 5px}
  </style></head><body><div class="card"><p style="margin:0 0 6px;font-weight:600">App running on port ${port}</p>
  <p style="margin:0;color:#71717a;font-size:12.5px">Simulated forwarded port. With a real codespace this pane shows <code>https://&lt;codespace&gt;-${port}.app.github.dev</code>.</p></div></body></html>`;
}
