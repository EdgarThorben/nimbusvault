import { get } from "@vercel/blob";
import type { APIRoute } from "astro";
import { blobToken } from "../../lib/blob";
import { photoBelongsToToken } from "../../lib/jobs";

export const prerender = false;

/** Streams a private job photo to Leo, or to a customer holding that job's approval token. */
export const GET: APIRoute = async ({ params, url, locals }) => {
  const path = params.path ?? "";
  const notFound = () => new Response("Not found", { status: 404 });
  if (!path.startsWith("jobs/") || path.includes("..")) return notFound();

  if (!locals.user) {
    const token = url.searchParams.get("t");
    if (!token || !(await photoBelongsToToken(path, token))) return notFound();
  }

  const result = await get(path, { access: "private", token: blobToken() });
  if (!result || result.statusCode !== 200) return notFound();

  return new Response(result.stream, {
    headers: {
      "content-type": result.blob.contentType,
      "cache-control": "private, max-age=86400",
      "referrer-policy": "no-referrer",
    },
  });
};
