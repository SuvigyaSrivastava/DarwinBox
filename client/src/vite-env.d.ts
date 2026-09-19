/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Server origin for a split deployment (client on Vercel, server elsewhere).
   * Empty/unset in local dev, where requests go same-origin through the Vite
   * proxy — see vite.config.ts and src/lib/api.ts. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
