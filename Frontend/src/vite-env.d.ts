/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin. Empty in development: Vite proxies /api to the backend. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
