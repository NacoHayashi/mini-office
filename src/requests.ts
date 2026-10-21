// Requests that want an answer travel over the office WebSocket as
// { t: kind, rid, body }. The reply carries the same rid so the page can
// resolve the matching promise even when several requests are in flight.

export const REQUEST_KINDS = ["setup", "score", "leaderboard"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export type Outcome = { status: number; data: Record<string, unknown> };

const RID = /^[A-Za-z0-9_-]{1,32}$/;

export function requestKind(value: unknown): RequestKind | null {
  return (REQUEST_KINDS as readonly unknown[]).includes(value) ? (value as RequestKind) : null;
}

export function requestId(value: unknown): string | null {
  return typeof value === "string" && RID.test(value) ? value : null;
}

// Same shape the HTTP routes accepted: a missing body is {}, anything that is
// not a plain object is refused.
export function requestBody(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function reply(rid: string, outcome: Outcome) {
  return { ...outcome.data, t: "reply", rid, status: outcome.status, ok: outcome.status < 400 };
}
