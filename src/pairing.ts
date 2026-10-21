import { safeEqual, sha256 } from "./crypto";

export const AUTH_WINDOW_MS = 10 * 60 * 1000;
export const AUTH_LIMIT = 8;
export const PAIR_CODE_TTL_MS = 5 * 60 * 1000;

export type PairTicket = {
  hash: string;
  expiresAt: number;
};

export type PairVerdict = "ok" | "missing" | "expired" | "mismatch";

export type LegacyMember = {
  id: string;
  device_key: string | null;
  session_token: string | null;
  session_epoch: number;
  created_at: number;
};

export type MigratedDevice = {
  id: string;
  deviceKey: string;
  memberId: string;
  createdAt: number;
  lastSeen: number;
};

export type MigratedSession = {
  tokenHash: string;
  memberId: string;
  deviceKey: string;
  epoch: number;
  createdAt: number;
};

const DEVICE_KEY = /^[a-f0-9]{32,128}$/;

export function randomPairCode(): string {
  let out = "";
  const bytes = new Uint8Array(1);
  while (out.length < 6) {
    crypto.getRandomValues(bytes);
    if (bytes[0] >= 250) continue;
    out += String(bytes[0] % 10);
  }
  return out;
}

export function normalizePairCode(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length === 6 ? digits : null;
}

export function normalizeDeviceKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return DEVICE_KEY.test(key) ? key : null;
}

export async function hashPairCode(code: string): Promise<string> {
  return sha256(`pair:${code}`);
}

export function hashesMatch(left: string, right: string): boolean {
  return safeEqual(left, right);
}

export function freshPair(hash: string, now: number): PairTicket {
  return { hash, expiresAt: now + PAIR_CODE_TTL_MS };
}

const PAIR_HASH_WIDTH = 64;

export function judgePair(ticket: PairTicket | null, hash: string, now: number): PairVerdict {
  const stored = ticket?.hash ?? "0".repeat(PAIR_HASH_WIDTH);
  const match = hashesMatch(stored, hash);
  if (!ticket) return "missing";
  if (ticket.expiresAt <= now) return "expired";
  if (!match) return "mismatch";
  return "ok";
}

export function tooManyFailures(
  times: number[],
  now: number,
  windowMs = AUTH_WINDOW_MS,
  limit = AUTH_LIMIT,
): boolean {
  let count = 0;
  for (const at of times) if (now - at < windowMs) count += 1;
  return count >= limit;
}

export function migrateLegacyBindings(rows: LegacyMember[]): {
  devices: MigratedDevice[];
  sessions: MigratedSession[];
} {
  const devices: MigratedDevice[] = [];
  const sessions: MigratedSession[] = [];
  for (const row of rows) {
    const deviceKey = normalizeDeviceKey(row.device_key);
    if (!deviceKey) continue;
    const createdAt = Number(row.created_at) || 0;
    devices.push({
      id: `leg_${row.id}`,
      deviceKey,
      memberId: row.id,
      createdAt,
      lastSeen: createdAt,
    });
    const tokenHash = String(row.session_token || "");
    if (!tokenHash) continue;
    sessions.push({
      tokenHash,
      memberId: row.id,
      deviceKey,
      epoch: Number(row.session_epoch) || 0,
      createdAt,
    });
  }
  return { devices, sessions };
}
