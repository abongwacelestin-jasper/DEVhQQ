import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
});
