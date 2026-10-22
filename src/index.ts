import { ADMIN_SESSION_MS } from "./admin-session";
import { tokenEqual } from "./crypto";
import { json, readCookie } from "./http";
import { bearer, OfficeRoom, type Env } from "./office-room";
import { panelResponse } from "./panel";
import { TELEGRAM_MARKER, telegramRoute } from "./telegram-login";

export { OfficeRoom };

const ADMIN_MARKER = "x-office-admin";
const GATE_MARKER = "x-office-gate";
const IP_MARKER = "x-office-ip";
const ADMIN_COOKIE = "office_admin";
const ADMIN_COOKIE_AGE = ADMIN_SESSION_MS / 1000;
const ADMIN_COOKIE_PATH = "/api/office/admin";

function configuredSeed(env: Env): string {
  return (env.APP_SEED ?? "").trim();
}

function adminCookie(token: string, maxAge: number, path = ADMIN_COOKIE_PATH): string {
  const value = maxAge > 0 ? encodeURIComponent(token) : "";
  return `${ADMIN_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAge}`;
}

function clientIp(request: Request): string {
  return (request.headers.get("cf-connecting-ip") || "local").slice(0, 80);
}

function stamp(request: Request, trustedAdmin: boolean): Request {
  const headers = new Headers(request.headers);
  headers.delete(ADMIN_MARKER);
  headers.delete(GATE_MARKER);
  headers.delete(IP_MARKER);
  headers.delete(TELEGRAM_MARKER);
  headers.set(IP_MARKER, clientIp(request));
  if (trustedAdmin) headers.set(ADMIN_MARKER, "1");
  return new Request(request, { headers });
}

async function gate(stub: DurableObjectStub, request: Request, event: "check" | "fail" | "ok"): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/json",
    [GATE_MARKER]: "1",
    [IP_MARKER]: clientIp(request),
  });
  return stub.fetch("https://office.internal/api/office/admin/gate", {
    method: "POST",
    headers,
    body: JSON.stringify({ event }),
  });
}

function clearAdminCookie(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", adminCookie("", 0));
  // Also expire the cookie left by older versions.
  headers.append("set-cookie", adminCookie("", 0, "/"));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function postAdmin(stub: DurableObjectStub, path: string, body: Record<string, unknown>, trusted: boolean): Promise<Response> {
  return stub.fetch(`https://office.internal${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(trusted ? { [ADMIN_MARKER]: "1" } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function finishAdmin(stub: DurableObjectStub, request: Request, path: string, method: string): Promise<Response> {
  if (path === "/api/office/admin/health" && method === "GET") return json({ ok: true });
  if (path === "/api/office/admin/sessions/revoke" && method === "POST") {
    await request.text();
    const revoked = await postAdmin(stub, path, {}, true);
    if (!revoked.ok) return revoked;
    return clearAdminCookie(json({ ok: true }, revoked.status));
  }
  const forwarded = await stub.fetch(stamp(request, true));
  if (path === "/api/office/admin/password" && method === "POST" && forwarded.ok) return clearAdminCookie(forwarded);
  return forwarded;
}

function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin") || "";
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/office" || url.pathname === "/office/") {
      return Response.redirect(new URL("/", url).href, 302);
    }
    const panel = panelResponse(request, env.APP_SLUG);
    if (panel) return panel;
    if (!url.pathname.startsWith("/api/office")) return env.ASSETS.fetch(request);
    try {
      const method = request.method.toUpperCase();
      const mutating = method === "POST" || method === "PUT" || method === "DELETE";
      const socketUpgrade = url.pathname === "/api/office/ws" && method === "GET";
      if (mutating || socketUpgrade) {
        if (!sameOrigin(request, url)) return json({ error: "來源不符" }, 403);
      }
      const stub = env.OFFICE.get(env.OFFICE.idFromName("main"));
      if (url.pathname.startsWith("/api/office/telegram")) return await telegramRoute(stamp(request, false), env, stub);
      if (url.pathname.startsWith("/api/office/admin/")) {
        const expected = configuredSeed(env);
        if (!expected) return json({ error: "伺服器尚未完成設定。" }, 503);
        const cookie = readCookie(request, ADMIN_COOKIE);
        if (url.pathname === "/api/office/admin/logout" && method === "POST") {
          if (cookie) await postAdmin(stub, "/api/office/admin/session/drop", { token: cookie }, false);
          return clearAdminCookie(json({ ok: true }));
        }
        const presented = bearer(request).trim();
        const checked = await gate(stub, request, "check");
        if (checked.status === 429) return json({ error: "嘗試太多次，請稍後再試" }, 429);
        if (presented && (await tokenEqual(presented, expected))) {
          await gate(stub, request, "ok");
          if (url.pathname === "/api/office/admin/session" && method === "POST") {
            const issued = await postAdmin(stub, "/api/office/admin/session/issue", {}, true);
            if (!issued.ok) return json({ error: "辦公室暫時沒有回應" }, 502);
            const data = (await issued.json()) as { token?: string };
            if (!data.token) return json({ error: "辦公室暫時沒有回應" }, 502);
            return json({ ok: true }, 200, { "set-cookie": adminCookie(data.token, ADMIN_COOKIE_AGE) });
          }
          return await finishAdmin(stub, request, url.pathname, method);
        }
        if (!presented && cookie) {
          const session = await postAdmin(stub, "/api/office/admin/session/check", { token: cookie }, false);
          if (session.ok) {
            await gate(stub, request, "ok");
            return await finishAdmin(stub, request, url.pathname, method);
          }
          const detail = (await session.json().catch(() => ({}))) as { reason?: string };
          if (detail.reason === "expired") return clearAdminCookie(json({ error: "驗證失敗" }, 401));
        }
        const failed = await gate(stub, request, "fail");
        if (failed.status === 429) return json({ error: "嘗試太多次，請稍後再試" }, 429);
        return json({ error: "驗證失敗" }, 401);
      }
      return await stub.fetch(stamp(request, false));
    } catch (error) {
      console.error(error);
      return json({ error: "辦公室暫時沒有回應" }, 500);
    }
  },
};
