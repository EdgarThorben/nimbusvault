export function blobToken(): string | undefined {
  return import.meta.env?.BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
}
