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
 *  - Google Fonts (index.css) and the Monaco loader on cdn.jsdelivr.net until both are self-hosted.
 * The edge should send the same policy as a header; this <meta> is the fallback
 * when the static host doesn't (frame-ancestors can only be enforced by a header).
 */
const sandboxHash = `'sha256-${createHash('sha256').update(SANDBOX_BOOTSTRAP).digest('base64')}'`;
const MONACO_CDN = 'https://cdn.jsdelivr.net';
// --- Turnstile (bot check on sign-in, recovery, accept-invite): api.js + its iframe.
// Only script-src and frame-src; the widget makes its own requests inside its frame.
const TURNSTILE = 'https://challenges.cloudflare.com';
// --- end Turnstile

function csp(mode: 'build' | 'dev'): string {
  const dev = mode === 'dev';
  return [
    "default-src 'self'",
    // Dev only: @vitejs/plugin-react injects an inline refresh preamble.
    `script-src 'self' ${dev ? "'unsafe-inline'" : sandboxHash} ${MONACO_CDN} ${TURNSTILE}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${MONACO_CDN}`,
    `font-src 'self' data: https://fonts.gstatic.com ${MONACO_CDN}`,
    "img-src 'self' data: blob: https://avatars.githubusercontent.com",
    `connect-src 'self' https://api.github.com ${MONACO_CDN}${dev ? ' ws://127.0.0.1:5173 ws://localhost:5173' : ''}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    `frame-src 'self' ${TURNSTILE}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
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
export default defineConfig({
  plugins: [react(), cspMeta()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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
