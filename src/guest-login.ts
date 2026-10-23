import { ANIMALS, normalizeName } from "./content";
import { deleteMemberData, type OfficeSql } from "./migrations";

export const GUEST_PREFIX = "guest-";
export const GUEST_MAX = 10;
export const GUEST_IDLE_MS = 30 * 60 * 1000;

// Ids that only the office hands out, so nobody can register one that looks
// like a guest or a Telegram account.
export function reservedLoginId(id: string): boolean {
  return id.startsWith(GUEST_PREFIX) || id.startsWith("tg-");
}

// Socket messages a guest may not send: they cannot rearrange the office,
// or rename themselves. Returns the error to show, or null.
export function guestBlocks(kind: unknown, body: Record<string, unknown>, name: string): string | null {
  if (kind === "furn" || (kind === "edit" && body.on)) return "訪客不能調整設備";
  // The mirror sends the current name along with a new look; only a real rename is refused.
  if (kind === "profile" && body.displayName !== undefined && normalizeName(body.displayName) !== name) return "訪客不能改名稱";
  return null;
}

// 訪客 plus a short number that no member or guest is using as a name.
export function guestName(taken: Set<string>, random = Math.random): string {
  for (let i = 0; i < 50; i++) {
    const name = `訪客${100 + Math.floor(random() * 900)}`;
    if (!taken.has(name)) return name;
  }
  return `訪客${1000 + Math.floor(random() * 9000)}`;
}

export function guestAnimal(random = Math.random): string {
  return ANIMALS[Math.floor(random() * ANIMALS.length)]?.id ?? "cat";
}

export function isGuest(sql: OfficeSql, id: string): boolean {
  return sql.exec(`SELECT member_id FROM guests WHERE member_id = ?`, id).toArray().length > 0;
}

export function guestCount(sql: OfficeSql): number {
  return Number(sql.exec(`SELECT COUNT(*) AS n FROM guests`).one()?.n ?? 0);
}

export function touchGuest(sql: OfficeSql, id: string, now = Date.now()) {
  sql.exec(`UPDATE guests SET last_seen = ? WHERE member_id = ?`, now, id);
}

export function dropGuest(sql: OfficeSql, id: string) {
  deleteMemberData(sql, id);
  sql.exec(`DELETE FROM guests WHERE member_id = ?`, id);
}

// Removes guests nobody has seen for a while; online ones are skipped.
export function sweepGuests(sql: OfficeSql, online: (id: string) => boolean, now = Date.now()): string[] {
  const idle = sql
    .exec(`SELECT member_id FROM guests WHERE last_seen < ?`, now - GUEST_IDLE_MS)
    .toArray()
    .map((row) => String(row.member_id))
    .filter((id) => !online(id));
  for (const id of idle) dropGuest(sql, id);
  return idle;
}

// Turns a guest into a Telegram member in one transaction. A new account keeps
// the guest's row (name, look, spot, scores) under a fresh id; an account that
// is already linked keeps its own name and look and takes the guest's best
// score per game. Either way the guest and every guest session are gone.
export function upgradeGuest(sql: OfficeSql, guestId: string, telegramId: string, freshId: string, now = Date.now()): string {
  let memberId = freshId;
  sql.transaction(() => {
    const linked = sql
      .exec(`SELECT t.member_id FROM telegram_members t JOIN members m ON m.id = t.member_id WHERE t.telegram_id = ?`, telegramId)
      .toArray()[0];
    sql.exec(`DELETE FROM member_sessions WHERE member_id = ?`, guestId);
    sql.exec(`DELETE FROM guests WHERE member_id = ?`, guestId);
    if (linked) {
      memberId = String(linked.member_id);
      sql.exec(
        `INSERT INTO scores (member_id, game, score, updated_at)
         SELECT ?, game, score, updated_at FROM scores WHERE member_id = ? AND true
         ON CONFLICT (member_id, game) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at
         WHERE excluded.score > scores.score`,
        memberId,
        guestId,
      );
      for (const table of ["scores", "score_hits", "member_devices", "pair_codes"]) sql.exec(`DELETE FROM ${table} WHERE member_id = ?`, guestId);
      sql.exec(`DELETE FROM members WHERE id = ?`, guestId);
      return;
    }
    sql.exec(`UPDATE members SET id = ? WHERE id = ?`, memberId, guestId);
    for (const table of ["scores", "score_hits", "member_devices", "pair_codes"]) sql.exec(`UPDATE ${table} SET member_id = ? WHERE member_id = ?`, memberId, guestId);
    sql.exec(`DELETE FROM telegram_members WHERE telegram_id = ?`, telegramId);
    sql.exec(`INSERT INTO telegram_members (telegram_id, member_id, created_at) VALUES (?, ?, ?)`, telegramId, memberId, now);
  });
  return memberId;
}
