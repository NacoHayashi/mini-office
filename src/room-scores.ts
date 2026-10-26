// Arcade high scores and the leaderboard.
import { acceptScore, admitScoreHit, scorePace } from "./content";
import { type Outcome } from "./requests";
import { type MemberRow, SCORE_GAMES } from "./room-base";
import { RoomAdmin } from "./room-admin";

export abstract class RoomScores extends RoomAdmin {
  protected scoreOf(memberId: string, game: string): number {
    const rows = this.sql
      .exec<{ score: number }>(`SELECT score FROM scores WHERE member_id = ? AND game = ?`, memberId, game)
      .toArray();
    return rows[0] ? Number(rows[0].score) : 0;
  }

  protected allowScore(memberId: string, game: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    this.sweepLimits(now);
    const hits = this.sql
      .exec<{ at: number }>(
        `SELECT at FROM score_hits WHERE member_id = ? AND game = ? AND at >= ?`,
        memberId,
        game,
        now - windowMs,
      )
      .toArray()
      .map((row) => Number(row.at));
    if (!admitScoreHit(hits, now, limit, windowMs).ok) return false;
    this.sql.exec(`INSERT INTO score_hits (member_id, game, at) VALUES (?, ?, ?)`, memberId, game, now);
    return true;
  }

  protected writeScore(memberId: string, game: string, score: number) {
    this.sql.exec(`DELETE FROM scores WHERE member_id = ? AND game = ?`, memberId, game);
    this.sql.exec(
      `INSERT INTO scores (member_id, game, score, updated_at) VALUES (?, ?, ?, ?)`,
      memberId,
      game,
      score,
      Date.now(),
    );
  }

  protected submitScore(member: MemberRow, body: Record<string, unknown> | null): Outcome {
    if (!body) return { status: 400, data: { error: "格式不對" } };
    const game = typeof body.game === "string" ? body.game : "";
    const spec = SCORE_GAMES[game];
    if (!spec) return { status: 400, data: { error: "沒有這個遊戲" } };
    const current = this.scoreOf(member.id, game);
    const accepted = acceptScore(spec, current, body);
    if (!accepted.ok) return { status: 400, data: { error: "分數不對" } };
    if (!accepted.changed) return { status: 200, data: { game, score: current } };
    const pace = scorePace(spec.mode);
    if (!this.allowScore(member.id, game, pace.limit, pace.windowMs)) return { status: 429, data: { error: "太快了，稍等一下" } };
    this.writeScore(member.id, game, accepted.score);
    this.broadcast({ t: "score", game });
    return { status: 200, data: { game, score: accepted.score } };
  }

  protected leaderboard(member: MemberRow): Outcome {
    const games = Object.entries(SCORE_GAMES).map(([id, spec]) => {
      const rows = this.sql
        .exec<{ member_id: string; display_name: string; score: number }>(
          `SELECT s.member_id, m.display_name, s.score
           FROM scores s JOIN members m ON m.id = s.member_id
           WHERE s.game = ?
           ORDER BY s.score DESC, s.updated_at ASC, s.member_id ASC`,
          id,
        )
        .toArray();
      const ranked = rows.map((row, index) => ({
        rank: index + 1,
        id: row.member_id,
        displayName: row.display_name,
        score: Number(row.score),
      }));
      const mine = ranked.find((row) => row.id === member.id) || null;
      return {
        id,
        title: spec.title,
        unit: spec.unit,
        top: ranked.slice(0, 10),
        me: mine ? { rank: mine.rank, score: mine.score } : null,
      };
    });
    return { status: 200, data: { games } };
  }
}
