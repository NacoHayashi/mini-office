// These files are bundled into the Worker and served only under APP_SLUG.
// Without APP_SLUG they are not served.
import page from "../panel/index.html";
import style from "../panel/panel.css";
import script from "../panel/panel.js";

const SAFE_PATH = /^(\/[A-Za-z0-9._~-]+)+$/;

const FILES: Record<string, { body: string; type: string }> = {
  "/": { body: page, type: "text/html; charset=utf-8" },
  "/panel.css": { body: style, type: "text/css; charset=utf-8" },
  "/panel.js": { body: script, type: "text/javascript; charset=utf-8" },
};

// "/a/b", "a/b/", " /a/b// " all become "/a/b". Anything empty, the site root,
// the API, or a path with dot segments turns the page off.
export function normalizeSlug(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (!SAFE_PATH.test(path)) return null;
  if (path.split("/").some((part) => part === "." || part === "..")) return null;
  if (path === "/api" || path.startsWith("/api/")) return null;
  return path;
}

export function panelResponse(request: Request, raw: string | undefined): Response | null {
  const base = normalizeSlug(raw);
  if (!base) return null;
  const url = new URL(request.url);
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return null;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  // Relative links in the page need the trailing slash.
  if (url.pathname === base) return Response.redirect(new URL(`${base}/`, url).href, 302);
  const file = FILES[url.pathname.slice(base.length)];
  if (!file) return null;
  return new Response(method === "HEAD" ? null : file.body, {
    headers: {
      "content-type": file.type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      "x-robots-tag": "noindex",
      "content-security-policy": "base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
    },
  });
}
