import { sha256 } from "./crypto";

export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

export type AdminSessionRecord = {
  hash: string;
  createdAt: number;
  expiresAt: number;
};

export type AdminSessionState = "ok" | "expired" | "missing";

export async function adminSessionHash(token: string): Promise<string> {
  return sha256(token);
}

export function adminSessionRecord(hash: string, now: number): AdminSessionRecord {
  return { hash, createdAt: now, expiresAt: now + ADMIN_SESSION_MS };
}

export function adminSessionState(record: { expiresAt: number } | null, now: number): AdminSessionState {
  if (!record) return "missing";
  if (now >= record.expiresAt) return "expired";
  return "ok";
}

export function adminSessionsAfterRevoke<T extends { hash: string }>(rows: T[], drop: "all" | string): T[] {
  if (drop === "all") return [];
  return rows.filter((row) => row.hash !== drop);
}
