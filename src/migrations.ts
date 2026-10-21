import { readMeta, writeMeta } from "./crypto";
import { migrateLegacyBindings, type LegacyMember } from "./pairing";

export const SCHEMA_VERSION = 8;

export type FurnitureSeed = { id: string; kind: string; x: number; y: number; rot: number };

export type SqlRows = {
  toArray: () => Array<Record<string, unknown>>;
  one: () => Record<string, unknown> | null;
};

export type OfficeSql = {
  exec: (query: string, ...bindings: unknown[]) => SqlRows;
  transaction: (run: () => void) => void;
};

export type OfficeBackup = {
  kind: "office-backup";
  schemaVersion: number;
  meta: Array<{ key: string; value: string }>;
  members: Array<Record<string, unknown>>;
  devices: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  furniture: Array<Record<string, unknown>>;
  scores: Array<Record<string, unknown>>;
};

function readVersion(sql: OfficeSql): number {
  return Number(readMeta(sql, "schema_version") || "0");
}

export function ensureTables(sql: OfficeSql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    animal TEXT,
    accessories TEXT NOT NULL DEFAULT '{}',
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    pos_dir INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS furniture (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    rot INTEGER NOT NULL DEFAULT 0
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS scores (
    member_id TEXT NOT NULL,
    game TEXT NOT NULL,
    score INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (member_id, game)
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS auth_failures (
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    at INTEGER NOT NULL
  )`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_auth_failures_lookup ON auth_failures(kind, subject, at)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS member_devices (
    id TEXT PRIMARY KEY,
    device_key TEXT NOT NULL UNIQUE,
    member_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_member_devices_member ON member_devices(member_id)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS member_sessions (
    token_hash TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    device_key TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_member_sessions_member ON member_sessions(member_id)`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_member_sessions_device ON member_sessions(device_key)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS pair_codes (
    member_id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`);
}

function seedFurnitureIfEmpty(sql: OfficeSql, defaults: FurnitureSeed[]) {
  const count = sql.exec(`SELECT COUNT(*) AS n FROM furniture`).one();
  if (Number(count?.n ?? 0) > 0) return;
  for (const item of defaults) {
    sql.exec(
      `INSERT INTO furniture (id, kind, x, y, rot) VALUES (?, ?, ?, ?, ?)`,
      item.id,
      item.kind,
      item.x,
      item.y,
      item.rot,
    );
  }
}

async function plainSessionUpdates(sql: OfficeSql, hash: (token: string) => Promise<string>) {
  const rows = sql.exec(`SELECT id, session_token FROM members`).toArray();
  const updates: Array<{ id: string; token: string; hashed: string }> = [];
  for (const row of rows) {
    const token = row.session_token;
    const id = row.id;
    if (typeof id !== "string" || typeof token !== "string" || !token || token.startsWith("sha256:")) continue;
    updates.push({ id, token, hashed: `sha256:${await hash(token)}` });
  }
  return updates;
}

function memberColumn(sql: OfficeSql, name: string): boolean {
  return sql.exec(`SELECT name FROM pragma_table_info('members') WHERE name = ?`, name).toArray().length > 0;
}

function migrateDevices(sql: OfficeSql) {
  if (!memberColumn(sql, "device_key")) return;
  const rows = sql
    .exec(`SELECT id, device_key, session_token, session_epoch, created_at FROM members`)
    .toArray()
    .map((row) => ({
      id: String(row.id),
      device_key: typeof row.device_key === "string" ? row.device_key : null,
      session_token: typeof row.session_token === "string" ? row.session_token : null,
      session_epoch: Number(row.session_epoch) || 0,
      created_at: Number(row.created_at) || 0,
    })) satisfies LegacyMember[];
  const plan = migrateLegacyBindings(rows);
  for (const device of plan.devices) {
    sql.exec(
      `INSERT OR IGNORE INTO member_devices (id, device_key, member_id, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?)`,
      device.id,
      device.deviceKey,
      device.memberId,
      device.createdAt,
      device.lastSeen,
    );
  }
  for (const session of plan.sessions) {
    sql.exec(
      `INSERT OR IGNORE INTO member_sessions (token_hash, member_id, device_key, epoch, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      session.tokenHash,
      session.memberId,
      session.deviceKey,
      session.epoch,
      session.createdAt,
    );
  }
}

export function addSystemFurniture(sql: OfficeSql, defaults: FurnitureSeed[]) {
  const raw = readMeta(sql, "system_furniture");
  let known: unknown = [];
  try {
    known = raw ? JSON.parse(raw) : [];
  } catch {
    known = [];
  }
  const seen = new Set(Array.isArray(known) ? known.filter((id): id is string => typeof id === "string") : []);
  for (const item of defaults) {
    if (seen.has(item.id)) continue;
    const existing = sql.exec(`SELECT id FROM furniture WHERE id = ?`, item.id).toArray()[0];
    if (!existing) {
      sql.exec(
        `INSERT INTO furniture (id, kind, x, y, rot) VALUES (?, ?, ?, ?, ?)`,
        item.id,
        item.kind,
        item.x,
        item.y,
        item.rot,
      );
    }
    seen.add(item.id);
  }
  for (const item of defaults) {
    if (item.kind !== "snackcab" && item.kind !== "vendor") continue;
    sql.exec(`UPDATE furniture SET rot = ? WHERE id = ? AND kind = ?`, item.rot, item.id, item.kind);
  }
  writeMeta(sql, "system_furniture", JSON.stringify([...seen]));
}

export async function runMigrations(
  sql: OfficeSql,
  defaults: FurnitureSeed[],
  hash: (token: string) => Promise<string>,
) {
  sql.transaction(() => ensureTables(sql));
  let version = readVersion(sql);
  if (version < 1) {
    sql.transaction(() => {
      seedFurnitureIfEmpty(sql, defaults);
      if (!readMeta(sql, "epoch")) writeMeta(sql, "epoch", "1");
      writeMeta(sql, "seeded", "1");
      writeMeta(sql, "schema_version", "1");
    });
    version = 1;
  }
  if (version < 2) {
    const updates = memberColumn(sql, "session_token") ? await plainSessionUpdates(sql, hash) : [];
    sql.transaction(() => {
      for (const update of updates) {
        sql.exec(
          `UPDATE members SET session_token = ? WHERE id = ? AND session_token = ?`,
          update.hashed,
          update.id,
          update.token,
        );
      }
      writeMeta(sql, "schema_version", "2");
    });
    version = 2;
  }
  if (version < 3) {
    sql.transaction(() => {
      migrateDevices(sql);
      writeMeta(sql, "schema_version", "3");
    });
    version = 3;
  }
  if (version < 4) {
    sql.transaction(() => {
      addSystemFurniture(sql, defaults);
      writeMeta(sql, "schema_version", "4");
    });
    version = 4;
  }
  if (version < 5) {
    sql.transaction(() => {
      sql.exec(`CREATE TABLE IF NOT EXISTS score_hits (
        member_id TEXT NOT NULL,
        game TEXT NOT NULL,
        at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE INDEX IF NOT EXISTS idx_score_hits_lookup ON score_hits(member_id, game, at)`);
      writeMeta(sql, "schema_version", "5");
    });
    version = 5;
  }
  if (version < 6) {
    sql.transaction(() => {
      sql.exec(`CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`);
      writeMeta(sql, "schema_version", "6");
    });
    version = 6;
  }
  if (version < 7) {
    sql.transaction(() => {
      migrateDevices(sql);
      sql.exec(`DROP INDEX IF EXISTS idx_members_session`);
      sql.exec(`CREATE TABLE members_next (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        animal TEXT,
        accessories TEXT NOT NULL DEFAULT '{}',
        pos_x REAL NOT NULL,
        pos_y REAL NOT NULL,
        pos_dir INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      )`);
      sql.exec(
        `INSERT INTO members_next (id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at)
         SELECT id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at FROM members`,
      );
      sql.exec(`DROP TABLE members`);
      sql.exec(`ALTER TABLE members_next RENAME TO members`);
      writeMeta(sql, "schema_version", "7");
    });
    version = 7;
  }
  if (version < 8) {
    sql.transaction(() => {
      sql.exec(
        `UPDATE furniture SET rot = 270 WHERE id = 'sofa-right' AND kind = 'sofa' AND rot = 90 AND x = 1160 AND y = 840`,
      );
      writeMeta(sql, "schema_version", "8");
    });
    version = 8;
  }
  sql.transaction(() => addSystemFurniture(sql, defaults));
}

export function deleteMemberData(sql: OfficeSql, id: string) {
  sql.transaction(() => {
    sql.exec(`DELETE FROM scores WHERE member_id = ?`, id);
    sql.exec(`DELETE FROM member_sessions WHERE member_id = ?`, id);
    sql.exec(`DELETE FROM member_devices WHERE member_id = ?`, id);
    sql.exec(`DELETE FROM pair_codes WHERE member_id = ?`, id);
    sql.exec(`DELETE FROM members WHERE id = ?`, id);
  });
}

function rows(sql: OfficeSql, query: string): Array<Record<string, unknown>> {
  return sql.exec(query).toArray();
}

export function exportOffice(sql: OfficeSql): OfficeBackup {
  return {
    kind: "office-backup",
    schemaVersion: readVersion(sql),
    meta: rows(sql, `SELECT key, value FROM meta ORDER BY key`).map((row) => ({
      key: String(row.key),
      value: String(row.value),
    })),
    members: rows(
      sql,
      `SELECT id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at
       FROM members ORDER BY id`,
    ),
    devices: rows(sql, `SELECT id, device_key, member_id, created_at, last_seen FROM member_devices ORDER BY id`),
    sessions: rows(
      sql,
      `SELECT token_hash, member_id, device_key, epoch, created_at FROM member_sessions ORDER BY token_hash`,
    ),
    furniture: rows(sql, `SELECT id, kind, x, y, rot FROM furniture ORDER BY id`),
    scores: rows(sql, `SELECT member_id, game, score, updated_at FROM scores ORDER BY member_id, game`),
  };
}

function asRows(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  if (value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) return null;
  return value as Array<Record<string, unknown>>;
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function backupShape(raw: unknown):
  | { ok: false; error: string }
  | {
      ok: true;
      meta: Array<Record<string, unknown>>;
      members: Array<Record<string, unknown>>;
      devices: Array<Record<string, unknown>>;
      sessions: Array<Record<string, unknown>>;
      furniture: Array<Record<string, unknown>>;
      scores: Array<Record<string, unknown>>;
    } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "備份格式不對" };
  const body = raw as Record<string, unknown>;
  if (body.kind !== "office-backup") return { ok: false, error: "備份格式不對" };
  const schemaVersion = body.schemaVersion;
  if (typeof schemaVersion !== "number" || schemaVersion < 1 || schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: "這份備份沒辦法還原" };
  }
  const meta = asRows(body.meta);
  const members = asRows(body.members);
  const devices = asRows(body.devices);
  const sessions = asRows(body.sessions);
  const furniture = asRows(body.furniture);
  const scores = asRows(body.scores);
  if (!meta || !members || !devices || !sessions || !furniture || !scores) return { ok: false, error: "備份格式不對" };
  if (meta.some((row) => typeof row.key !== "string" || typeof row.value !== "string" || !row.key)) {
    return { ok: false, error: "備份格式不對" };
  }
  if (!unique(meta.map((row) => String(row.key)))) return { ok: false, error: "備份格式不對" };
  const memberIds: string[] = [];
  for (const row of members) {
    const id = text(row, "id");
    const name = text(row, "display_name");
    if (!id || !name) return { ok: false, error: "備份格式不對" };
    if (row.device_key != null && typeof row.device_key !== "string") return { ok: false, error: "備份格式不對" };
    if (row.animal != null && typeof row.animal !== "string") return { ok: false, error: "備份格式不對" };
    if (row.session_token != null && typeof row.session_token !== "string") return { ok: false, error: "備份格式不對" };
    memberIds.push(id);
  }
  if (!unique(memberIds)) return { ok: false, error: "備份格式不對" };
  const known = new Set(memberIds);
  const deviceIds: string[] = [];
  const deviceKeys: string[] = [];
  for (const row of devices) {
    const id = text(row, "id");
    const deviceKey = text(row, "device_key");
    const memberId = text(row, "member_id");
    if (!id || !deviceKey || !memberId || !known.has(memberId)) return { ok: false, error: "備份格式不對" };
    deviceIds.push(id);
    deviceKeys.push(deviceKey);
  }
  if (!unique(deviceIds) || !unique(deviceKeys)) return { ok: false, error: "備份格式不對" };
  const sessionHashes: string[] = [];
  for (const row of sessions) {
    const hash = text(row, "token_hash");
    const memberId = text(row, "member_id");
    const deviceKey = text(row, "device_key");
    if (!hash || !memberId || !deviceKey || !known.has(memberId)) return { ok: false, error: "備份格式不對" };
    sessionHashes.push(hash);
  }
  if (!unique(sessionHashes)) return { ok: false, error: "備份格式不對" };
  const furnitureIds: string[] = [];
  for (const row of furniture) {
    const id = text(row, "id");
    const kind = text(row, "kind");
    if (!id || !kind) return { ok: false, error: "備份格式不對" };
    furnitureIds.push(id);
  }
  if (!unique(furnitureIds)) return { ok: false, error: "備份格式不對" };
  const scoreKeys: string[] = [];
  for (const row of scores) {
    const memberId = text(row, "member_id");
    const game = text(row, "game");
    if (!memberId || !game || !known.has(memberId)) return { ok: false, error: "備份格式不對" };
    scoreKeys.push(`${memberId}\0${game}`);
  }
  if (!unique(scoreKeys)) return { ok: false, error: "備份格式不對" };
  return { ok: true, meta, members, devices, sessions, furniture, scores };
}

function deleteIfPresent(sql: OfficeSql, table: "score_hits" | "admin_sessions") {
  const found = sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).toArray();
  if (found.length) sql.exec(`DELETE FROM ${table}`);
}

function clearStoredSessions(sql: OfficeSql) {
  sql.exec(`DELETE FROM member_sessions`);
  sql.exec(`DELETE FROM pair_codes`);
  deleteIfPresent(sql, "score_hits");
  deleteIfPresent(sql, "admin_sessions");
}

export function clearLiveOffice(live: {
  chairs: { clear(): void };
  bumpAt: { clear(): void };
  whisperAsks: { clear(): void };
  msgHits: { clear(): void };
  furnMoveAt: { clear(): void };
  setChairsReady(ready: boolean): void;
  /** Re-reads state derived from meta (snack stock, held snacks) so stale memory cannot overwrite the restore. */
  reloadMeta(): void;
}) {
  live.reloadMeta();
  live.chairs.clear();
  live.setChairsReady(false);
  live.bumpAt.clear();
  live.whisperAsks.clear();
  live.msgHits.clear();
  live.furnMoveAt.clear();
}

export function restoreOffice(sql: OfficeSql, raw: unknown): { ok: true } | { ok: false; error: string } {
  const parsed = backupShape(raw);
  if (!parsed.ok) return parsed;
  try {
    sql.transaction(() => {
      ensureTables(sql);
      sql.exec(`DELETE FROM scores`);
      sql.exec(`DELETE FROM member_sessions`);
      sql.exec(`DELETE FROM member_devices`);
      sql.exec(`DELETE FROM pair_codes`);
      sql.exec(`DELETE FROM furniture`);
      sql.exec(`DELETE FROM members`);
      sql.exec(`DELETE FROM meta`);
      for (const row of parsed.meta) {
        sql.exec(`INSERT INTO meta (key, value) VALUES (?, ?)`, row.key, row.value);
      }
      const seenDevices = new Set(parsed.devices.map((row) => String(row.device_key).toLowerCase()));
      for (const row of parsed.members) {
        sql.exec(
          `INSERT INTO members
           (id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id,
          row.display_name,
          row.animal ?? null,
          typeof row.accessories === "string" ? row.accessories : "{}",
          Number(row.pos_x) || 0,
          Number(row.pos_y) || 0,
          Number(row.pos_dir) || 1,
          Number(row.created_at) || 0,
        );
        const legacyKey = typeof row.device_key === "string" ? row.device_key.toLowerCase() : "";
        if (legacyKey && !seenDevices.has(legacyKey)) {
          seenDevices.add(legacyKey);
          sql.exec(
            `INSERT INTO member_devices (id, device_key, member_id, created_at, last_seen) VALUES (?, ?, ?, ?, ?)`,
            `leg_${row.id}`,
            legacyKey,
            row.id,
            Number(row.created_at) || 0,
            Number(row.created_at) || 0,
          );
        }
      }
      for (const row of parsed.devices) {
        sql.exec(
          `INSERT INTO member_devices (id, device_key, member_id, created_at, last_seen) VALUES (?, ?, ?, ?, ?)`,
          row.id,
          row.device_key,
          row.member_id,
          Number(row.created_at) || 0,
          Number(row.last_seen) || 0,
        );
      }
      for (const row of parsed.furniture) {
        sql.exec(
          `INSERT INTO furniture (id, kind, x, y, rot) VALUES (?, ?, ?, ?, ?)`,
          row.id,
          row.kind,
          Number(row.x) || 0,
          Number(row.y) || 0,
          Number(row.rot) || 0,
        );
      }
      for (const row of parsed.scores) {
        sql.exec(
          `INSERT INTO scores (member_id, game, score, updated_at) VALUES (?, ?, ?, ?)`,
          row.member_id,
          row.game,
          Number(row.score) || 0,
          Number(row.updated_at) || 0,
        );
      }
      clearStoredSessions(sql);
    });
  } catch {
    return { ok: false, error: "備份格式不對" };
  }
  return { ok: true };
}
