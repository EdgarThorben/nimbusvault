import { defineMiddleware } from "astro:middleware";
import { SESSION_COOKIE_NAME, getSessionUser } from "./lib/auth";

// Pages a customer (or the browser installing the app) may load without Leo's session.
// /p/ checks its own access (session or approval token); actions check their own too.
const PUBLIC_PREFIXES = ["/login", "/a/", "/p/", "/_astro/", "/_actions/", "/icons/"];
const PUBLIC_FILES = ["/manifest.webmanifest", "/favicon.svg", "/favicon.ico", "/sw.js", "/offline.html", "/robots.txt", "/404"];

export const onRequest = defineMiddleware(async (context, next) => {
  const sessionId = context.cookies.get(SESSION_COOKIE_NAME)?.value;
  context.locals.user = sessionId ? await getSessionUser(sessionId) : null;

  const path = context.url.pathname;
  const isPublic = PUBLIC_FILES.includes(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
  if (!context.locals.user && !isPublic) {
    if (context.request.method === "GET") return context.redirect("/login");
    return new Response("Unauthorized", { status: 401 });
  }

  return next();
});
