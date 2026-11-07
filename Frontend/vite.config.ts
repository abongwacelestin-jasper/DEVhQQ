import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { SANDBOX_BOOTSTRAP } from './src/utils/codeRunner';

/**
 * Content-Security-Policy for the SPA, mirroring `Backend/security/headers.ts`
 * (no inline or eval'd scripts, no plugins, no <base> rewriting) plus what the
 * SPA itself needs:
 *  - the code sandbox's srcdoc bootstrap, allowed by hash (srcdoc frames inherit this policy),
 *  - `worker-src blob:` for sandbox and editor workers,
 *  - the few third-party origins listed in THIRD_PARTY below.
 * Fonts and the Monaco editor are self-hosted (src/assets/fonts, monaco-editor in the
 * bundle), so styles, fonts and editor code are 'self' only.
 * The edge should send the same policy as a header (infra/frontend/Caddyfile, keep the
 * two in step); this <meta> is the fallback when the static host doesn't
 * (frame-ancestors can only be enforced by a header).
 */
const sandboxHash = `'sha256-${createHash('sha256').update(SANDBOX_BOOTSTRAP).digest('base64')}'`;

// ── Third-party origins: the only place to add one ──────────────────────────
// Cloudflare Turnstile (sign-in, forgot password, accept invite): the widget script
// and its challenge iframe. Owned by the Turnstile change; mirrored in the Caddyfile.
const TURNSTILE = 'https://challenges.cloudflare.com';
const THIRD_PARTY = {
  script: [TURNSTILE],
  frame: [TURNSTILE],
  img: ['https://avatars.githubusercontent.com'],
  connect: ['https://api.github.com'],
};
const extra = (list: string[]) => (list.length ? ` ${list.join(' ')}` : '');

function csp(mode: 'build' | 'dev'): string {
  const dev = mode === 'dev';
  return [
    "default-src 'self'",
    // Dev only: @vitejs/plugin-react injects an inline refresh preamble.
    `script-src 'self' ${dev ? "'unsafe-inline'" : sandboxHash}${extra(THIRD_PARTY.script)}`,
    // 'unsafe-inline' styles: Monaco, framer-motion and sonner set style attributes at runtime.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob:${extra(THIRD_PARTY.img)}`,
    `connect-src 'self'${extra(THIRD_PARTY.connect)}${dev ? ' ws://127.0.0.1:5173 ws://localhost:5173' : ''}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    `frame-src 'self'${extra(THIRD_PARTY.frame)}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Preloads the latin Inter file from index.html, so the text font is requested with
 * the HTML instead of after the stylesheet is parsed. The name is content-hashed, so
 * it is read from the bundle.
 */
function preloadCriticalFont(): Plugin {
  return {
    name: 'devhq-preload-font',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const font = Object.keys(ctx.bundle ?? {}).find((f) =>
          /inter-latin-wght-normal-[\w-]+\.woff2$/.test(f),
        );
        if (!font) return [];
        return [
          {
            tag: 'link',
            attrs: {
              rel: 'preload',
              href: `/${font}`,
              as: 'font',
              type: 'font/woff2',
              crossorigin: '',
            },
            injectTo: 'head',
          },
        ];
      },
    },
  };
}

/** Fills the CSP <meta> in builds; in dev the policy is sent as a header instead (see server.headers). */
function cspMeta(): Plugin {
  return {
    name: 'devhq-csp-meta',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const isBuild = !ctx.server;
        return html.replace(
          /<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/,
          isBuild ? `<meta http-equiv="Content-Security-Policy" content="${csp('build')}" />` : '',
        );
      },
    },
  };
}

const devHeaders = {
  'Content-Security-Policy': csp('dev'),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)',
};

// https://vitejs.dev/config/
/**
 * Chunk budget. Every chunk must stay under 500 kB (minified) except the Monaco
 * editor and its language workers, which only load in the code workspace and
 * are several MB by nature. Replaces Vite's blanket size warning (which cannot
 * exempt them) with a check that fails the build, so a regression in the entry
 * or a page chunk cannot slip through as a warning.
 */
const CHUNK_BUDGET = 500_000;
function chunkBudget(): Plugin {
  return {
    name: 'devhq-chunk-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const c of Object.values(bundle)) {
        if (c.type !== 'chunk' || c.code.length <= CHUNK_BUDGET) continue;
        if (c.moduleIds.some((id) => id.includes('/node_modules/monaco-editor/'))) continue;
        this.error(`${c.fileName} is ${c.code.length} bytes, over the ${CHUNK_BUDGET} budget`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), cspMeta(), preloadCriticalFont(), chunkBudget()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Monaco's language workers (src/components/code/monacoLoader.ts) are module workers.
  worker: { format: 'es', plugins: () => [chunkBudget()] },
  build: {
    // Enforced per chunk by chunkBudget() above; the editor's chunks are exempt there.
    chunkSizeWarningLimit: 8_000,
    rolldownOptions: {
      // Build-speed diagnostics only (Monaco makes the build slower), not a size or code issue.
      checks: { bundlerTimings: false },
    },
  },
  server: {
    // Pin the dev origin: it must match the backend's APP_ORIGIN for CSRF/WebAuthn
    // checks, and binding 127.0.0.1 avoids "vite is only on ::1" surprises.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    headers: devHeaders,
    // Same origin for the app and the API, exactly like production behind the edge:
    // no CORS preflight, and the Secure __Host- session cookie behaves normally.
    proxy: {
      '/api': {
        // 127.0.0.1, not localhost: the API binds both families, and the proxy
        // should not depend on how the OS resolves "localhost" first.
        target: process.env.DEVHQ_API_URL ?? 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
  preview: {
    headers: { ...devHeaders, 'Content-Security-Policy': csp('build') },
  },
});
