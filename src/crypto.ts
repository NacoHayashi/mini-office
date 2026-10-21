export const PBKDF2_ITERS = 100_000;

export function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return hex(buffer);
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(new Uint8Array(digest));
}

export function safeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function tokenEqual(input: string, expected: string): Promise<boolean> {
  if (!input || !expected) return false;
  const [left, right] = await Promise.all([sha256(input), sha256(expected)]);
  return safeEqual(left, right);
}

export type PasswordMeta = {
  salt: string | null;
  hash: string | null;
  kdf: string | null;
  iters: string | null;
};

export type PasswordHash = {
  salt: string;
  hash: string;
  iters: string;
};

export async function passwordVerdict(password: string, meta: PasswordMeta): Promise<"legacy" | "current" | false> {
  const { salt, hash } = meta;
  if (!salt || !hash) return false;
  if (meta.kdf === "pbkdf2") {
    const iters = Number(meta.iters || String(PBKDF2_ITERS));
    const rounds = Number.isFinite(iters) && iters > 0 ? iters : PBKDF2_ITERS;
    const digest = await pbkdf2(password, salt, rounds);
    return safeEqual(digest, hash) ? "current" : false;
  }
  const digest = await sha256(`${salt}:${password}`);
  return safeEqual(digest, hash) ? "legacy" : false;
}

export async function passwordHash(password: string, iters = PBKDF2_ITERS): Promise<PasswordHash> {
  const salt = randomToken(16);
  const hash = await pbkdf2(password, salt, iters);
  return { salt, hash, iters: String(iters) };
}

type MetaRows = { toArray: () => Array<Record<string, unknown>> };

export type MetaSql = {
  exec: (query: string, ...bindings: unknown[]) => MetaRows;
};

export function readMeta(sql: MetaSql, key: string): string | null {
  const row = sql.exec(`SELECT value FROM meta WHERE key = ?`, key).toArray()[0];
  return row && typeof row.value === "string" ? row.value : null;
}

export function writeMeta(sql: MetaSql, key: string, value: string) {
  sql.exec(`DELETE FROM meta WHERE key = ?`, key);
  sql.exec(`INSERT INTO meta (key, value) VALUES (?, ?)`, key, value);
}

async function pbkdf2(password: string, salt: string, iters: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: iters },
    key,
    256,
  );
  return hex(new Uint8Array(bits));
}
