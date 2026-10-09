/// <reference types="vite/client" />

// Extend this interface to add type-safe environment variables.
// Variables must be prefixed with VITE_ to be exposed to the client.
// Add matching entries to .env.example for documentation.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
