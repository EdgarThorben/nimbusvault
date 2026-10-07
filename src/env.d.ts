/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly BLOB_READ_WRITE_TOKEN: string;
}

declare namespace App {
  interface Locals {
    user: {
      id: string;
      email: string;
      displayName: string;
    } | null;
  }
}
