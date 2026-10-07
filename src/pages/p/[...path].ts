import { get } from "@vercel/blob";
import type { APIRoute } from "astro";
import { getShareLinkByToken } from "../../lib/shareQueries";

export const prerender = false;

export const GET: APIRoute = async ({ params, url, locals }) => {
  const path = params.path ?? "";
  if (!path.startsWith("jobs/") || path.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  if (!locals.user) {
    const token = url.searchParams.get("t");
    const row = token ? await getShareLinkByToken(token) : null;
    // The token only unlocks photos belonging to its own item.
    if (!row || !row.item.photos.includes(path)) {
      return new Response("Not found", { status: 404 });
    }
  }

  const blobToken = import.meta.env?.BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN;
  const result = await get(path, { access: "private", token: blobToken });
  if (!result || result.statusCode !== 200) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(result.stream, {
    headers: {
      "content-type": result.blob.contentType,
      "cache-control": "private, max-age=3600",
    },
  });
};
