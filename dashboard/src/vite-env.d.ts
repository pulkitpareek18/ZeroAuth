/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_CONSOLE_BASE_URL?: string;
  readonly VITE_DOCS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
