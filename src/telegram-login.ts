import { normalizeName } from "./content";
import { hex, safeEqual } from "./crypto";
import { json } from "./http";

export const TELEGRAM_MARKER = "x-office-telegram";
const MAX_AGE_S = 24 * 60 * 60;
const SKEW_S = 5 * 60;

export type TelegramEnv = { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_BOT_USERNAME?: string };
export type TelegramUser = { telegramId: string; name: string };

// Both settings are needed; a half-configured bot just hides the button.
export function telegramBot(env: TelegramEnv): { token: string; username: string } | null {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const username = (env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "");
  if (!token || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
  return { token, username };
}

async function hmacHex(secret: ArrayBuffer, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))));
}

// Checks a Telegram Login Widget payload and returns who signed in, or null.
export async function checkTelegramAuth(raw: unknown, botToken: string, now = Date.now()): Promise<TelegramUser | null> {
  if (!botToken || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const hash = typeof data.hash === "string" ? data.hash.toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const lines: string[] = [];
  for (const key of Object.keys(data).filter((name) => name !== "hash").sort()) {
    const value = data[key];
    if (typeof value !== "string" && typeof value !== "number") return null;
    lines.push(`${key}=${value}`);
  }
  const secret = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botToken));
  if (!safeEqual(await hmacHex(secret, lines.join("\n")), hash)) return null;
  const authDate = Number(data.auth_date);
  const nowS = now / 1000;
  if (!Number.isFinite(authDate) || nowS - authDate > MAX_AGE_S || authDate - nowS > SKEW_S) return null;
  const telegramId = String(data.id ?? "");
  if (!/^[1-9]\d{0,19}$/.test(telegramId)) return null;
  const full = [data.first_name, data.last_name].filter((part) => typeof part === "string").join(" ");
  const name = normalizeName(full) || normalizeName(data.username) || `Telegram ${telegramId.slice(-4)}`;
  return { telegramId, name };
}

// Runs in the Worker, where the bot token lives. Only a checked identity is
// handed to the Durable Object.
export async function telegramRoute(request: Request, env: TelegramEnv, stub: DurableObjectStub): Promise<Response> {
  const bot = telegramBot(env);
  const url = new URL(request.url);
  // A guest switching to Telegram posts to /upgrade; the office checks its session cookie.
  const upgrade = url.pathname === "/api/office/telegram/upgrade";
  if (url.pathname !== "/api/office/telegram" && !upgrade) return json({ error: "找不到" }, 404);
  if (request.method === "GET" && !upgrade) return json({ bot: bot ? bot.username : null });
  if (request.method !== "POST") return json({ error: "找不到" }, 404);
  if (!bot) return json({ error: "沒有開放 Telegram 登入" }, 404);
  const text = await request.text();
  if (text.length > 4000) return json({ error: "格式不對" }, 400);
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text) as Record<string, unknown> | null;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") return json({ error: "格式不對" }, 400);
  const user = await checkTelegramAuth(body.auth, bot.token);
  if (!user) return json({ error: "Telegram 驗證失敗，請再試一次" }, 401);
  return stub.fetch(`https://office.internal/api/office/telegram/${upgrade ? "upgrade" : "enter"}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [TELEGRAM_MARKER]: "1",
      "x-office-ip": request.headers.get("x-office-ip") ?? "local",
      cookie: request.headers.get("cookie") ?? "",
    },
    body: JSON.stringify({ ...user, deviceKey: body.deviceKey, password: body.password }),
  });
}
