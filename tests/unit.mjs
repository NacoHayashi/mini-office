import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import test from "node:test";
import vm from "node:vm";
import esbuild from "esbuild";

const outdir = mkdtempSync(join(tmpdir(), "office-unit-"));
const outfile = join(outdir, "content.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/content.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
});
const content = await import(pathToFileURL(outfile).href);
const pairFile = join(outdir, "pairing.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/pairing.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: pairFile,
});
const pairing = await import(pathToFileURL(pairFile).href);
const migrationFile = join(outdir, "migrations.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/migrations.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: migrationFile,
});
const migrations = await import(pathToFileURL(migrationFile).href);
const stallFile = join(outdir, "stalls.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/stalls.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: stallFile,
});
const stalls = await import(pathToFileURL(stallFile).href);
const lalaFile = join(outdir, "lala.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../public/office/lala.js")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: lalaFile,
});
const { lalaHeading } = await import(pathToFileURL(lalaFile).href);

function officeDb() {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    sql: {
      exec(query, ...bindings) {
        const statement = db.prepare(query);
        const rows = /^\s*select/i.test(query) ? statement.all(...bindings) : [];
        if (!/^\s*select/i.test(query)) statement.run(...bindings);
        return { toArray: () => rows, one: () => rows[0] ?? null };
      },
      transaction(run) {
        db.exec("BEGIN");
        try {
          run();
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
}
const sessionFile = join(outdir, "admin-session.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/admin-session.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: sessionFile,
});
const adminSession = await import(pathToFileURL(sessionFile).href);
const cryptoFile = join(outdir, "crypto.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/crypto.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: cryptoFile,
});
const officeCrypto = await import(pathToFileURL(cryptoFile).href);
const snackFile = join(outdir, "snacks.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/snacks.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: snackFile,
});
const snacks = await import(pathToFileURL(snackFile).href);
const toyFile = join(outdir, "toys.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/toys.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: toyFile,
});
const toys = await import(pathToFileURL(toyFile).href);
const requestFile = join(outdir, "requests.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/requests.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: requestFile,
});
const requests = await import(pathToFileURL(requestFile).href);
const askFile = join(outdir, "ask.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../public/office/requests.js")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: askFile,
});
const { createRequests } = await import(pathToFileURL(askFile).href);
const panelFile = join(outdir, "panel.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/panel.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: panelFile,
  plugins: [{
    name: "panel-text",
    setup(build) {
      build.onLoad({ filter: /[\\/]panel[\\/][^\\/]+\.(html|css|js)$/ }, (args) => ({
        contents: readFileSync(args.path, "utf8"),
        loader: "text",
      }));
    },
  }],
});
const panel = await import(pathToFileURL(panelFile).href);

function loadPuzzle(name) {
  const html = readFileSync(join(import.meta.dirname, "../games", `${name}.html`), "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const source = blocks.find((block) => block.includes("module.exports"));
  assert.ok(source, `${name} 沒有可測試的腳本`);
  const sandbox = {
    module: { exports: {} },
    console,
    Math,
    Date,
    Set,
    Map,
    Array,
    Object,
    Number,
    String,
    JSON,
    parseInt,
    isNaN,
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(source, sandbox, { filename: `${name}.html` });
  return sandbox.module.exports;
}

test("checkId accepts office ids and rejects reserved or short ones", () => {
  assert.equal(content.checkId("momo").ok, true);
  assert.equal(content.checkId("momo").id, "momo");
  assert.equal(content.checkId("a").ok, false);
  assert.equal(content.checkId("Lala").ok, false);
});

test("配件顏色沒填是米白，只接受預設色", () => {
  const cat = content.presetLook("cat");
  assert.equal(cat.colors.accessory, "#f3eee3");
  assert.equal(content.catalog().accessorySwatches[0], "#f3eee3");
  const colors = { ...cat.colors };
  delete colors.accessory;
  assert.equal(content.normalizeLook({ ...cat, colors }).colors.accessory, "#f3eee3");
  assert.equal(content.normalizeLook({ body: "bean", held: "mug" }).colors.accessory, "#f3eee3");
  const partial = content.normalizeLook({ body: "mochi", colors: { body: "#fff6ea" } });
  assert.equal(partial.colors.body, "#fff6ea");
  assert.equal(partial.colors.accessory, "#f3eee3");
  assert.equal(content.normalizeLook({ ...cat, colors: { ...cat.colors, accessory: "#7AA6EE" } }).colors.accessory, "#7aa6ee");
  assert.equal(content.normalizeLook({ ...cat, colors: { ...cat.colors, accessory: "#112233" } }), null);
  assert.equal(content.normalizeLook({ ...cat, colors: { ...cat.colors, accessory: "ivory" } }), null);
});

test("已存的造型遇到下架的配件色會退回預設，不會整個失效", () => {
  const cat = content.presetLook("cat");
  const saved = JSON.stringify({ ...cat, head: "beanie", colors: { ...cat.colors, accessory: "#112233" } });
  const look = content.readStoredLook("custom", saved);
  assert.ok(look, "造型不該失效");
  assert.equal(look.head, "beanie");
  assert.equal(look.colors.accessory, "#f3eee3");
  assert.equal(content.readStoredLook("custom", JSON.stringify({ ...cat, colors: { ...cat.colors, accessory: "#7aa6ee" } })).colors.accessory, "#7aa6ee");
});

test("眼鏡框維持深色，不跟著配件顏色", () => {
  const world = readFileSync(join(import.meta.dirname, "../public/office/world3d.js"), "utf8");
  const glasses = world.slice(world.indexOf('if (glasses === "round"'), world.indexOf('addMesh(parent, geo("lensFill"'));
  assert.match(glasses, /const ring = mat\(0x8a6248/);
  assert.doesNotMatch(glasses, /\), dye,/);
});

test("names and chat drop controls and bidi marks", () => {
  assert.equal(content.normalizeName(" 小\u0007熊\u202E "), "小熊");
  assert.equal(content.normalizeChat("\u2066你好\u202A"), "你好");
  assert.equal(content.normalizeName("   "), null);
  assert.equal(content.normalizeName("\u200E"), null);
});

test("new passwords need 8 characters and login still allows 4", () => {
  assert.equal(content.checkPassword("1234").ok, true);
  assert.equal(content.checkPassword("123").ok, false);
  assert.equal(content.checkNewPassword("1234567").ok, false);
  assert.equal(content.checkNewPassword("12345678").ok, true);
  assert.match(content.checkNewPassword("short").error, /8/);
});

test("buildOffice furniture stays on open floor", () => {
  const office = content.buildOffice();
  assert.ok(office.walls.length > 0);
  assert.ok(office.furniture.length > 0);
});

test("wall checks use a radius and furniture samples its edges", () => {
  const office = content.buildOffice();
  let wall = null;
  let open = null;
  for (let y = 1; y < office.walls.length - 1 && (!wall || !open); y++) {
    for (let x = 1; x < office.walls[y].length - 1; x++) {
      const here = office.walls[y][x] === "1";
      if (here && !wall) wall = { x, y };
      const clear = !here && [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => office.walls[y + dy][x + dx] === "0"));
      if (clear && !open) open = { x, y };
    }
  }
  assert.ok(wall && open);
  assert.equal(content.hitsWall(office.walls, wall.x * 32 + 16, wall.y * 32 + 16), true);
  assert.equal(content.hitsWall(office.walls, open.x * 32 + 16, open.y * 32 + 16), false);
  assert.equal(content.furnitureFits(office.walls, "chair", wall.x * 32, wall.y * 32, 0), false);
  assert.equal(content.furnitureFits(office.walls, "chair", open.x * 32, open.y * 32, 0), true);
});

test("score hits survive a restart and old rows are removed", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE score_hits (member_id TEXT NOT NULL, game TEXT NOT NULL, at INTEGER NOT NULL)`);
  const insertHit = db.prepare(`INSERT INTO score_hits (member_id, game, at) VALUES (?, ?, ?)`);
  const loadHits = db.prepare(`SELECT at FROM score_hits WHERE member_id = ? AND game = ? AND at >= ?`);
  function allow(now) {
    db.prepare(`DELETE FROM score_hits WHERE at < ?`).run(now - 60_000);
    const pace = content.scorePace("max");
    const hits = loadHits.all("momo", "match3", now - pace.windowMs).map((row) => Number(row.at));
    if (!content.admitScoreHit(hits, now, pace.limit, pace.windowMs).ok) return false;
    insertHit.run("momo", "match3", now);
    return true;
  }
  const start = 10_000_000;
  for (let i = 0; i < content.scorePace("max").limit; i++) assert.equal(allow(start + i), true);
  assert.equal(allow(start + content.scorePace("max").limit), false);
  assert.equal(allow(start + content.scorePace("max").windowMs + 1), true);
  insertHit.run("momo", "match3", 1);
  allow(start + 120_000);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM score_hits WHERE at < ?`).get(start).n, 0);
  db.close();
});

test("scores reject impossible jumps and increment puzzles by one", () => {
  const specs = content.scoreSpecs();
  assert.equal(specs.zip.mode, "inc");
  assert.deepEqual(content.acceptScore(specs.zip, 3, { op: "solve", score: 99 }), {
    ok: true,
    score: 4,
    changed: true,
  });
  assert.equal(content.acceptScore(specs.zip, 3, { score: 4 }).ok, false);
  const cat = specs.cat2048;
  assert.equal(content.acceptScore(cat, 0, { score: cat.maxDelta }).ok, true);
  assert.equal(content.acceptScore(cat, 0, { score: cat.maxDelta + 1 }).ok, false);
  assert.equal(content.acceptScore(cat, 0, { score: 999999999 }).ok, false);
  assert.equal(content.acceptScore(specs.match3, 0, { score: 10 }).ok, true);
  assert.equal(content.acceptScore(specs.match3, 0, { score: 11 }).ok, false);
});

test("hibernation restore fills chairs from seats without clearing others", () => {
  const chairs = [
    { id: "c1", occupant: null },
    { id: "c2", occupant: "kept" },
  ];
  const next = content.restoreChairOccupants(chairs, [
    { id: "momo", seat: "c1" },
    { id: "naco", seat: null },
  ]);
  assert.equal(next[0].occupant, "momo");
  assert.equal(next[1].occupant, "kept");
  assert.equal(chairs[0].occupant, null);
});

test("zip validate accepts its own path", () => {
  const zip = loadPuzzle("zip");
  const puzzle = zip.generate(5);
  assert.equal(zip.validate(puzzle, puzzle.path), true);
  assert.equal(zip.validate(puzzle, puzzle.path.slice().reverse()), false);
});

test("queens solve finds the generated placement", () => {
  const queens = loadPuzzle("queens");
  const puzzle = queens.generate(5);
  const found = queens.solve(puzzle.N, puzzle.reg, 2);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], puzzle.sol);
});

test("sudoku keeps a unique solution", () => {
  const sudoku = loadPuzzle("sudoku");
  const puzzle = sudoku.generate(0);
  assert.equal(sudoku.count(puzzle.puzzle, 2), 1);
  assert.equal(sudoku.ok(puzzle.sol, 0, puzzle.sol[0] === 1 ? 2 : 1), false);
});

test("patches solve stays unique and fits checks shape", () => {
  const patches = loadPuzzle("patches");
  assert.equal(patches.fits({ n: 4, shape: "sq" }, 2, 2), true);
  assert.equal(patches.fits({ n: 4, shape: "sq" }, 4, 1), false);
  const puzzle = patches.generate(5);
  assert.equal(patches.solve(puzzle.N, puzzle.clues, 2).length, 1);
});

test("pairing codes expire, work once, and reject a wrong code", async () => {
  const now = 1_700_000_000_000;
  const code = "123456";
  const hash = await pairing.hashPairCode(code);
  const ticket = pairing.freshPair(hash, now);
  assert.equal(pairing.judgePair(ticket, hash, now + pairing.PAIR_CODE_TTL_MS - 1), "ok");
  assert.equal(pairing.judgePair(ticket, hash, now + pairing.PAIR_CODE_TTL_MS), "expired");
  assert.equal(pairing.judgePair(ticket, await pairing.hashPairCode("654321"), now), "mismatch");
  assert.equal(pairing.normalizePairCode("123 456"), "123456");
  assert.equal(pairing.normalizePairCode("12345"), null);
  const replacement = pairing.freshPair(await pairing.hashPairCode("111111"), now);
  assert.equal(pairing.judgePair(replacement, hash, now), "mismatch");
  assert.equal(pairing.judgePair(null, hash, now), "missing");
});

test("pairing attempts use the same failure window", () => {
  const now = 1_700_000_000_000;
  const recent = Array.from({ length: pairing.AUTH_LIMIT }, (_, index) => now - index * 1000);
  assert.equal(pairing.tooManyFailures(recent, now), true);
  assert.equal(pairing.tooManyFailures(recent.slice(1), now), false);
  const stale = recent.map((at) => at - pairing.AUTH_WINDOW_MS);
  assert.equal(pairing.tooManyFailures(stale, now), false);
});

test("legacy members keep their device and session", async () => {
  const key = "ab".repeat(16);
  const token = `sha256:${"cd".repeat(32)}`;
  const plan = pairing.migrateLegacyBindings([
    {
      id: "momo",
      device_key: key.toUpperCase(),
      session_token: token,
      session_epoch: 4,
      created_at: 50,
    },
    {
      id: "guest",
      device_key: "",
      session_token: "sha256:nope",
      session_epoch: 1,
      created_at: 10,
    },
  ]);
  assert.equal(plan.devices.length, 1);
  assert.equal(plan.devices[0].deviceKey, key);
  assert.equal(plan.devices[0].memberId, "momo");
  assert.equal(plan.sessions.length, 1);
  assert.equal(plan.sessions[0].tokenHash, token);
  assert.equal(plan.sessions[0].epoch, 4);
  assert.equal(plan.sessions[0].deviceKey, key);
  assert.equal(pairing.normalizeDeviceKey(`  ${key.toUpperCase()}  `), key);
  assert.equal(pairing.normalizeDeviceKey("ab"), null);
  assert.equal(pairing.normalizeDeviceKey(1), null);
  const stored = await officeCrypto.passwordHash("peach-1234");
  assert.equal(
    await officeCrypto.passwordVerdict("peach-1234", {
      salt: stored.salt,
      hash: stored.hash,
      kdf: "pbkdf2",
      iters: stored.iters,
    }),
    "current",
  );
  assert.equal(
    await officeCrypto.passwordVerdict("nope-1234", {
      salt: stored.salt,
      hash: stored.hash,
      kdf: "pbkdf2",
      iters: stored.iters,
    }),
    false,
  );
  const legacyHash = await officeCrypto.sha256(`${stored.salt}:peach-1234`);
  assert.equal(
    await officeCrypto.passwordVerdict("peach-1234", { salt: stored.salt, hash: legacyHash, kdf: null, iters: null }),
    "legacy",
  );
  assert.equal(officeCrypto.safeEqual("ab", "ab"), true);
  assert.equal(officeCrypto.safeEqual("ab", "abc"), false);
});

test("old office data upgrades in order without moving furniture people already placed", async () => {
  const { db, sql } = officeDb();
  sql.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  sql.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '1')`);
  sql.exec(`CREATE TABLE members (
    id TEXT PRIMARY KEY,
    device_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    animal TEXT,
    accessories TEXT NOT NULL DEFAULT '{}',
    session_token TEXT,
    session_epoch INTEGER NOT NULL DEFAULT 0,
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    pos_dir INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);
  sql.exec(
    `INSERT INTO members (id, device_key, display_name, animal, accessories, session_token, session_epoch, pos_x, pos_y, pos_dir, created_at)
     VALUES ('momo', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '桃', 'cat', '{}', 'plain-token', 2, 10, 20, 1, 5)`,
  );
  sql.exec(`CREATE TABLE furniture (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, rot INTEGER NOT NULL DEFAULT 0
  )`);
  sql.exec(`INSERT INTO furniture (id, kind, x, y, rot) VALUES ('chair-a', 'chair', 400, 80, 90)`);
  sql.exec(`INSERT INTO furniture (id, kind, x, y, rot) VALUES ('item-user', 'plant', 12, 16, 0)`);
  const defaults = [
    { id: "chair-a", kind: "chair", x: 10, y: 10, rot: 0 },
    { id: "lamp-new", kind: "lamp", x: 30, y: 40, rot: 0 },
  ];
  await migrations.runMigrations(sql, defaults, async (token) => `hash-${token}`);
  assert.equal(sql.exec(`SELECT name FROM pragma_table_info('members') WHERE name IN ('device_key', 'session_token', 'session_epoch')`).toArray().length, 0);
  assert.equal(sql.exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_members_session'`).toArray().length, 0);
  assert.equal(sql.exec(`SELECT device_key FROM member_devices WHERE member_id = 'momo'`).toArray()[0].device_key, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(sql.exec(`SELECT token_hash FROM member_sessions WHERE member_id = 'momo'`).toArray()[0].token_hash, "sha256:hash-plain-token");
  assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM member_devices`).toArray()[0].n, 1);
  assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM member_sessions`).toArray()[0].n, 1);
  const chair = sql.exec(`SELECT x, y, rot FROM furniture WHERE id = 'chair-a'`).toArray()[0];
  assert.equal(Number(chair.x), 400);
  assert.equal(Number(chair.y), 80);
  assert.equal(Number(chair.rot), 90);
  const lamp = sql.exec(`SELECT x, y FROM furniture WHERE id = 'lamp-new'`).toArray()[0];
  assert.equal(Number(lamp.x), 30);
  const user = sql.exec(`SELECT x FROM furniture WHERE id = 'item-user'`).toArray()[0];
  assert.equal(Number(user.x), 12);
  assert.equal(sql.exec(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0].value, "8");
  assert.equal(sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'score_hits'`).toArray().length, 1);
  assert.equal(sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_sessions'`).toArray().length, 1);
  await migrations.runMigrations(sql, [...defaults, { id: "bin-new", kind: "bin", x: 70, y: 80, rot: 0 }], async (token) => token);
  assert.equal(Number(sql.exec(`SELECT x FROM furniture WHERE id = 'chair-a'`).toArray()[0].x), 400);
  assert.equal(sql.exec(`SELECT id FROM furniture WHERE id = 'bin-new'`).toArray().length, 1);
  await migrations.runMigrations(sql, [...defaults, { id: "bin-new", kind: "bin", x: 1, y: 1, rot: 180 }], async (token) => token);
  assert.equal(Number(sql.exec(`SELECT x FROM furniture WHERE id = 'bin-new'`).toArray()[0].x), 70);
  db.close();
});

test("a removed device can be used to register someone else", async () => {
  const { db, sql } = officeDb();
  sql.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  sql.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '6')`);
  sql.exec(`CREATE TABLE members (
    id TEXT PRIMARY KEY,
    device_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    animal TEXT,
    accessories TEXT NOT NULL DEFAULT '{}',
    session_token TEXT,
    session_epoch INTEGER NOT NULL DEFAULT 0,
    pos_x REAL NOT NULL,
    pos_y REAL NOT NULL,
    pos_dir INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  )`);
  const key = "ab".repeat(16);
  sql.exec(
    `INSERT INTO members (id, device_key, display_name, animal, accessories, session_token, session_epoch, pos_x, pos_y, pos_dir, created_at)
     VALUES ('momo', ?, '桃', 'cat', '{}', NULL, 1, 3, 4, 1, 5)`,
    key,
  );
  sql.exec(`CREATE TABLE member_devices (
    id TEXT PRIMARY KEY,
    device_key TEXT NOT NULL UNIQUE,
    member_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`);
  sql.exec(`INSERT INTO member_devices (id, device_key, member_id, created_at, last_seen) VALUES ('dev', ?, 'momo', 1, 2)`, key);
  assert.throws(() =>
    sql.exec(
      `INSERT INTO members (id, device_key, display_name, animal, accessories, session_token, session_epoch, pos_x, pos_y, pos_dir, created_at)
       VALUES ('lala', ?, '奇', 'dog', '{}', NULL, 1, 1, 1, 1, 6)`,
      key,
    ),
  );
  await migrations.runMigrations(sql, [], async (token) => token);
  sql.exec(`DELETE FROM member_sessions WHERE device_key = ?`, key);
  sql.exec(`DELETE FROM member_devices WHERE device_key = ?`, key);
  sql.exec(
    `INSERT INTO members (id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at)
     VALUES ('lala', '奇', 'dog', '{}', 1, 1, 1, 6)`,
  );
  sql.exec(`INSERT INTO member_devices (id, device_key, member_id, created_at, last_seen) VALUES ('dev2', ?, 'lala', 6, 6)`, key);
  assert.equal(sql.exec(`SELECT member_id FROM member_devices WHERE device_key = ?`, key).toArray()[0].member_id, "lala");
  assert.equal(sql.exec(`SELECT id FROM members ORDER BY id`).toArray().map((row) => row.id).join(","), "lala,momo");
  db.close();
});

test("score hit storage is added by the next migration and omitted from backups", async () => {
  const { db, sql } = officeDb();
  sql.transaction(() => migrations.ensureTables(sql));
  assert.equal(sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'score_hits'`).toArray().length, 0);
  sql.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '4')`);
  await migrations.runMigrations(sql, [], async (token) => token);
  assert.equal(sql.exec(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0].value, "8");
  assert.equal(sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'score_hits'`).toArray().length, 1);
  sql.exec(`INSERT INTO score_hits (member_id, game, at) VALUES ('momo', 'zip', 1)`);
  const backup = migrations.exportOffice(sql);
  assert.equal(JSON.stringify(backup).includes("score_hits"), false);
  assert.equal(migrations.restoreOffice(sql, backup).ok, true);
  assert.equal(Number(sql.exec(`SELECT COUNT(*) AS n FROM score_hits`).toArray()[0].n), 0);
  db.close();
});

test("admin sessions are added by the following migration, swept when expired, and omitted from backups", async () => {
  const { db, sql } = officeDb();
  sql.transaction(() => migrations.ensureTables(sql));
  assert.equal(sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_sessions'`).toArray().length, 0);
  sql.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '5')`);
  await migrations.runMigrations(sql, [], async (token) => token);
  assert.equal(sql.exec(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0].value, "8");
  sql.exec(`INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES ('old', 1, 50)`);
  sql.exec(`INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES ('fresh', 1, 5000)`);
  sql.exec(`DELETE FROM admin_sessions WHERE expires_at <= ?`, 100);
  assert.equal(sql.exec(`SELECT token_hash FROM admin_sessions`).toArray().map((row) => row.token_hash).join(","), "fresh");
  const room = readFileSync(join(import.meta.dirname, "../src/office-room.ts"), "utf8");
  assert.match(room, /DELETE FROM admin_sessions WHERE expires_at <= \?/);
  const backup = migrations.exportOffice(sql);
  assert.equal(Object.hasOwn(backup, "admin_sessions"), false);
  assert.equal(JSON.stringify(backup).includes("fresh"), false);
  assert.equal(migrations.restoreOffice(sql, backup).ok, true);
  assert.equal(sql.exec(`SELECT token_hash FROM admin_sessions`).toArray().length, 0);
  db.close();
});

test("removing a member clears scores and devices together, and a backup round trip restores them", async () => {
  const { db, sql } = officeDb();
  await migrations.runMigrations(sql, [], async (token) => token);
  sql.exec(
    `INSERT INTO members (id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at)
     VALUES ('momo', '桃', 'cat', '{}', 3, 4, 1, 5)`,
  );
  sql.exec(`INSERT INTO member_devices (id, device_key, member_id, created_at, last_seen) VALUES ('dev', 'ab', 'momo', 1, 2)`);
  sql.exec(`INSERT INTO member_sessions (token_hash, member_id, device_key, epoch, created_at) VALUES ('sha256:abc', 'momo', 'ab', 1, 5)`);
  sql.exec(`INSERT INTO scores (member_id, game, score, updated_at) VALUES ('momo', 'zip', 3, 9)`);
  sql.exec(`INSERT INTO furniture (id, kind, x, y, rot) VALUES ('plant-1', 'plant', 8, 9, 0)`);
  const backup = migrations.exportOffice(sql);
  assert.equal(Object.hasOwn(backup.members[0], "device_key"), false);
  let calls = 0;
  const failing = {
    exec(query, ...bindings) {
      calls += 1;
      if (calls === 2) throw new Error("boom");
      return sql.exec(query, ...bindings);
    },
    transaction(run) {
      sql.transaction(run);
    },
  };
  assert.throws(() => migrations.deleteMemberData(failing, "momo"));
  assert.equal(sql.exec(`SELECT id FROM members`).toArray()[0].id, "momo");
  assert.equal(Number(sql.exec(`SELECT score FROM scores`).toArray()[0].score), 3);
  migrations.deleteMemberData(sql, "momo");
  assert.equal(sql.exec(`SELECT id FROM members`).toArray().length, 0);
  assert.equal(sql.exec(`SELECT member_id FROM scores`).toArray().length, 0);
  assert.equal(sql.exec(`SELECT id FROM member_devices`).toArray().length, 0);
  assert.equal(sql.exec(`SELECT token_hash FROM member_sessions`).toArray().length, 0);
  const restored = migrations.restoreOffice(sql, backup);
  assert.equal(restored.ok, true);
  assert.equal(sql.exec(`SELECT display_name FROM members WHERE id = 'momo'`).toArray()[0].display_name, "桃");
  assert.equal(sql.exec(`SELECT name FROM pragma_table_info('members') WHERE name = 'device_key'`).toArray().length, 0);
  assert.equal(sql.exec(`SELECT token_hash FROM member_sessions`).toArray().length, 0);
  assert.equal(sql.exec(`SELECT id FROM member_devices`).toArray().length, 1);
  assert.equal(Number(sql.exec(`SELECT score FROM scores WHERE game = 'zip'`).toArray()[0].score), 3);
  assert.equal(Number(sql.exec(`SELECT x FROM furniture WHERE id = 'plant-1'`).toArray()[0].x), 8);
  const again = migrations.exportOffice(sql);
  assert.equal(again.members.length, 1);
  assert.equal(again.sessions.length, 0);
  assert.equal(again.scores[0].score, 3);
  db.close();
});

test("a bad backup is refused before anything is replaced", async () => {
  const { db, sql } = officeDb();
  await migrations.runMigrations(sql, [], async (token) => token);
  sql.exec(
    `INSERT INTO members (id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at)
     VALUES ('stay', '留', 'cat', '{}', 1, 2, 1, 4)`,
  );
  sql.exec(`INSERT INTO scores (member_id, game, score, updated_at) VALUES ('stay', 'zip', 9, 1)`);
  const good = migrations.exportOffice(sql);
  const duplicateDevices = {
    ...good,
    devices: [
      { id: "d1", device_key: "same", member_id: "stay", created_at: 1, last_seen: 1 },
      { id: "d2", device_key: "same", member_id: "stay", created_at: 1, last_seen: 1 },
    ],
  };
  const duplicateMembers = {
    ...good,
    members: [
      { ...good.members[0], id: "same" },
      { ...good.members[0], id: "same" },
    ],
    devices: [],
    sessions: [],
    scores: [],
  };
  const guard = {
    exec(query, ...bindings) {
      return sql.exec(query, ...bindings);
    },
    transaction() {
      throw new Error("should not write");
    },
  };
  for (const backup of [duplicateDevices, duplicateMembers, { ...good, members: {} }, null, { kind: "nope" }]) {
    const refused = migrations.restoreOffice(guard, backup);
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "備份格式不對");
  }
  const tooNew = migrations.restoreOffice(guard, { ...good, schemaVersion: 99 });
  assert.equal(tooNew.ok, false);
  assert.equal(tooNew.error, "這份備份沒辦法還原");
  assert.equal(sql.exec(`SELECT id FROM members`).toArray()[0].id, "stay");
  assert.equal(Number(sql.exec(`SELECT score FROM scores`).toArray()[0].score), 9);
  db.close();
});

test("restore clears member and admin sessions and drops live office state", async () => {
  const { db, sql } = officeDb();
  await migrations.runMigrations(sql, [], async (token) => token);
  sql.exec(
    `INSERT INTO members (id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at)
     VALUES ('momo', '桃', 'cat', '{}', 3, 4, 1, 5)`,
  );
  sql.exec(`INSERT INTO member_sessions (token_hash, member_id, device_key, epoch, created_at) VALUES ('sha256:abc', 'momo', 'ab', 4, 5)`);
  sql.exec(`INSERT INTO pair_codes (member_id, code_hash, expires_at) VALUES ('momo', 'code', 9)`);
  sql.exec(`INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES ('admin-hash', 1, 2)`);
  sql.exec(`INSERT INTO score_hits (member_id, game, at) VALUES ('momo', 'zip', 1)`);
  const backup = migrations.exportOffice(sql);
  assert.equal(Object.hasOwn(backup, "score_hits"), false);
  const restored = migrations.restoreOffice(sql, backup);
  assert.equal(restored.ok, true);
  assert.equal(sql.exec(`SELECT name FROM pragma_table_info('members') WHERE name = 'session_token'`).toArray().length, 0);
  assert.equal(sql.exec(`SELECT token_hash FROM member_sessions`).toArray().length, 0);
  assert.equal(sql.exec(`SELECT member_id FROM pair_codes`).toArray().length, 0);
  assert.equal(sql.exec(`SELECT token_hash FROM admin_sessions`).toArray().length, 0);
  assert.equal(Number(sql.exec(`SELECT COUNT(*) AS n FROM score_hits`).toArray()[0].n), 0);
  const live = {
    chairs: new Map([["chair-a", { occupant: "momo" }]]),
    bumpAt: new Map([["momo", 1]]),
    whisperAsks: new Map([["momo", { group: "a", until: 2 }]]),
    msgHits: new Map([["momo", [1]]]),
    furnMoveAt: new Map([["momo", 1]]),
    ready: true,
    reloaded: 0,
    setChairsReady(ready) {
      this.ready = ready;
    },
    reloadMeta() {
      this.reloaded += 1;
    },
  };
  migrations.clearLiveOffice(live);
  assert.equal(live.reloaded, 1);
  assert.equal(live.chairs.size, 0);
  assert.equal(live.bumpAt.size, 0);
  assert.equal(live.whisperAsks.size, 0);
  assert.equal(live.msgHits.size, 0);
  assert.equal(live.furnMoveAt.size, 0);
  assert.equal(live.ready, false);
  const game = readFileSync(join(import.meta.dirname, "../public/office/game.js"), "utf8");
  const bye = game.slice(game.indexOf('message.t === "bye"'), game.indexOf("function send("));
  assert.match(bye, /reason === "elsewhere"/);
  assert.match(bye, /password: "辦公室密碼已更新，請重新輸入。"/);
  assert.match(bye, /restored: "辦公室已還原，請重新輸入。"/);
  assert.match(bye, /showGate\(text\)/);
  const room = readFileSync(join(import.meta.dirname, "../src/office-room.ts"), "utf8");
  assert.match(room, /clearLiveOffice\(/);
  assert.match(room, /goodbye\(ws, "restored"\)/);
  assert.match(room, /restored: 4007/);
  const adminPage = readFileSync(join(import.meta.dirname, "../panel/index.html"), "utf8");
  const adminJs = readFileSync(join(import.meta.dirname, "../panel/panel.js"), "utf8");
  assert.match(adminPage, /這份備份含有敏感資料/);
  assert.match(adminJs, /confirm\("這份備份含有敏感資料。確定要下載嗎？"\)/);
  db.close();
});

test("admin login keeps a separate expiring session and can drop one or all", async () => {
  const token = "c".repeat(64);
  const now = 1_700_000_000_000;
  const hash = await adminSession.adminSessionHash(token);
  assert.notEqual(hash, token);
  assert.equal(hash.length, 64);
  const record = adminSession.adminSessionRecord(hash, now);
  assert.equal(record.hash, hash);
  assert.equal(adminSession.adminSessionState(record, now + adminSession.ADMIN_SESSION_MS - 1), "ok");
  assert.equal(adminSession.adminSessionState(record, now + adminSession.ADMIN_SESSION_MS), "expired");
  assert.equal(adminSession.adminSessionState(null, now), "missing");
  const other = adminSession.adminSessionRecord(await adminSession.adminSessionHash("d".repeat(64)), now);
  assert.deepEqual(
    adminSession.adminSessionsAfterRevoke([record, other], hash).map((row) => row.hash),
    [other.hash],
  );
  assert.deepEqual(adminSession.adminSessionsAfterRevoke([record, other], "all"), []);
});

function angleGap(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

test("lala faces a nearby player in the room, otherwise the room", () => {
  const office = content.buildOffice();
  const lala = office.lala;
  const room = lalaHeading(lala, null, office.talk);
  assert.ok(angleGap(room, 0) < 0.02, `沒有人時應看向房間，實際 ${room}`);
  assert.equal(lalaHeading(lala, { x: Number.NaN, y: 10 }, office.talk), room);
  const beside = { x: lala.x + 80, y: lala.y + 90 };
  const toward = lalaHeading(lala, beside, office.talk);
  const expect = Math.atan2(beside.x - lala.x, beside.y - lala.y);
  assert.ok(angleGap(toward, expect) < 0.001, "靠近時應轉向玩家");
  assert.ok(angleGap(toward, room) > 0.4, "側前方不該只看著房間正中");
  const behind = { x: lala.x + 70, y: lala.y - 40 };
  assert.ok(angleGap(lalaHeading(lala, behind, office.talk), room) < 0.001, "牆那一側應改看向房間");
  const far = { x: lala.x, y: lala.y + 500 };
  assert.ok(angleGap(lalaHeading(lala, far, office.talk), room) < 0.001, "太遠應看向房間");
});

test("a chair returning home faces its desk, and a loose chair keeps its layout rotation", () => {
  const office = content.buildOffice();
  const desks = office.props.filter((prop) => prop.kind === "desk");
  const chairs = office.furniture.filter((item) => item.kind === "chair");
  const deskChairs = chairs.filter((item) => item.id.startsWith("desk-"));
  const meetChairs = chairs.filter((item) => item.id.startsWith("meet-"));
  assert.equal(deskChairs.length, 10);
  assert.equal(meetChairs.length, 4);
  for (const chair of deskChairs) {
    assert.equal(chair.rot, 0);
    assert.equal(content.chairHomeRotation(chair, desks, office.walls), 180);
  }
  for (const chair of meetChairs) {
    assert.equal(content.chairHomeRotation(chair, desks, office.walls), chair.rot);
    assert.equal(content.chairHomeRotation({ ...chair, rot: 90 }, desks, office.walls), 90);
  }
  const owned = { x: 200, y: 200, w: 128, h: 64, label: "1" };
  const other = { x: 200, y: 280, w: 128, h: 64, label: "2" };
  assert.equal(content.chairHomeRotation({ id: "desk-1-chair", x: 248, y: 272, rot: 0 }, [owned, other]), 180);
  assert.equal(content.chairHomeRotation({ id: "loose", x: 248, y: 272, rot: 90 }, [owned, other]), 0);
  assert.equal(content.chairHomeRotation({ id: "desk-1-chair", x: 248, y: 600, rot: 90 }, [owned]), 180);
  assert.equal(content.chairHomeRotation({ id: "west", x: 160, y: 219, rot: 0 }, [owned]), 90);
  assert.equal(content.chairHomeRotation({ id: "east", x: 336, y: 219, rot: 180 }, [owned]), 270);
  assert.equal(content.chairHomeRotation({ id: "north", x: 248, y: 166, rot: 180 }, [owned]), 0);
  assert.equal(content.chairHomeRotation({ id: "far", x: 800, y: 800, rot: 270 }, [owned]), 270);
  const walls = office.walls.map((row) => row.split(""));
  const tx = 10;
  const ty = 10;
  for (let y = ty - 2; y <= ty + 2; y++) {
    for (let x = tx - 2; x <= tx + 2; x++) walls[y][x] = "0";
  }
  walls[ty + 1][tx] = "1";
  walls[ty + 1][tx + 1] = "1";
  const joined = walls.map((row) => row.join(""));
  const x = tx * 32 + 2;
  const y = (ty + 1) * 32 - 30;
  const tight = { id: "tight", x, y, rot: 0 };
  const beside = { x: x - 136, y, w: 128, h: 64 };
  assert.equal(content.furnitureFits(joined, "chair", x, y, 270), false);
  assert.equal(content.chairHomeRotation(tight, [beside], joined), 0);
});

test("a turned chair occupies a different footprint than an unturned one", () => {
  assert.equal(content.quarterRot(90, 0), 90);
  assert.equal(content.quarterRot(undefined, 90), 90);
  assert.equal(content.quarterRot(45, 0), 0);
  const office = content.buildOffice();
  const walls = office.walls.map((row) => row.split(""));
  const tx = 10;
  const ty = 10;
  for (let y = ty - 2; y <= ty + 2; y++) {
    for (let x = tx - 2; x <= tx + 2; x++) walls[y][x] = "0";
  }
  walls[ty + 1][tx] = "1";
  walls[ty + 1][tx + 1] = "1";
  const joined = walls.map((row) => row.join(""));
  const x = tx * 32 + 2;
  const y = (ty + 1) * 32 - 30;
  assert.equal(content.furnitureFits(joined, "chair", x, y, 0), true);
  assert.equal(content.furnitureFits(joined, "chair", x, y, 90), false);
});

test("cat2048 merges equal tiles", () => {
  const cat = loadPuzzle("cat2048");
  const tiles = [
    { id: 1, v: 2, r: 0, c: 0 },
    { id: 2, v: 2, r: 0, c: 1 },
  ];
  const moved = cat.operate(tiles, "left");
  assert.equal(moved.moved, true);
  assert.equal(moved.tiles.some((tile) => tile.v === 4), true);
  assert.equal(cat.canMove([]), true);
});

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

test("snack stock goes down, refuses an empty tray, and waits out the cooldown", () => {
  const here = () => ({ x: 20, y: 20 });
  const room = new snacks.SnackRoom();
  assert.equal(room.use("momo").ok, false);
  const first = room.take("momo", "cookie", 20, 20, here, 1_000);
  assert.equal(first.ok, true);
  assert.equal(first.replaced, false);
  assert.equal(first.stock.cookie, snacks.SNACK_FULL - 1);
  assert.equal(room.view().cookie, snacks.SNACK_FULL - 1);
  assert.equal(room.hand("momo"), "cookie");
  const rushed = room.take("momo", "cookie", 20, 20, here, 1_000 + snacks.SNACK_COOLDOWN_MS - 1);
  assert.equal(rushed.ok, false);
  assert.equal(rushed.reason, "cool");
  assert.equal(room.view().cookie, snacks.SNACK_FULL - 1);
  assert.equal(room.hand("momo"), "cookie");
  const later = room.take("momo", "choco", 20, 20, here, 1_000 + snacks.SNACK_COOLDOWN_MS);
  assert.equal(later.ok, true);
  assert.equal(later.replaced, true);
  assert.equal(later.stock.choco, snacks.SNACK_FULL - 1);
  assert.equal(room.view().cookie, snacks.SNACK_FULL - 1);
  assert.equal(room.hand("momo"), "choco");
  const eaten = room.use("momo");
  assert.equal(eaten.ok, true);
  assert.equal(eaten.itemId, "choco");
  assert.equal(eaten.pose, "eat");
  assert.equal(room.hand("momo"), "");
  assert.equal(room.view().choco, snacks.SNACK_FULL - 1);
  assert.equal(room.use("momo").ok, false);
  const empty = new snacks.SnackRoom(JSON.stringify({ cookie: 0 }));
  const refused = empty.take("momo", "cookie", 0, 0, () => ({ x: 0, y: 0 }), 5_000);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "empty");
  assert.equal(empty.view().cookie, 0);
  const unknown = room.take("momo", "pizza", 20, 20, here, 9_000);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "unknown");
  const far = room.take("hana", "soda", 0, 0, () => ({ x: 400, y: 0 }), 0);
  assert.equal(far.ok, false);
  assert.equal(far.reason, "far");
  assert.equal(room.view().soda, snacks.SNACK_FULL);
});

test("held snacks survive a reload from storage and drop unknown items", () => {
  const room = new snacks.SnackRoom();
  const here = () => ({ x: 20, y: 20 });
  assert.equal(room.take("momo", "tea", 20, 20, here, 1_000).ok, true);
  const stock = room.save();
  const hands = room.saveHands();
  const woke = new snacks.SnackRoom(stock, hands);
  assert.equal(woke.hand("momo"), "tea");
  assert.equal(woke.view().tea, snacks.SNACK_FULL - 1);
  assert.deepEqual(woke.handsView(), [{ id: "momo", item: "tea", pose: "drink" }]);
  assert.deepEqual(woke.handsView((id) => id !== "momo"), []);
  const used = woke.use("momo");
  assert.equal(used.ok, true);
  assert.equal(new snacks.SnackRoom(woke.save(), woke.saveHands()).hand("momo"), "");
  assert.equal(woke.release("momo"), false);
  const messy = new snacks.SnackRoom(null, JSON.stringify({ momo: "steak", yuki: "cookie", "": "tea" }));
  assert.deepEqual(messy.handsView(), [{ id: "yuki", item: "cookie", pose: "eat" }]);
  assert.equal(new snacks.SnackRoom(null, "nope").handsView().length, 0);
  room.load(JSON.stringify({ cookie: 1 }), null);
  assert.equal(room.view().cookie, 1);
  assert.equal(room.hand("momo"), "");
  const room2 = readFileSync(join(import.meta.dirname, "../src/office-room.ts"), "utf8");
  assert.match(room2, /reloadMeta: \(\) => \{\s*this\.loadSnacks\(\);\s*this\.toys\.load\(this\.meta\(TOY_META\)\);/);
});

function toyRoomWith(holds) {
  const room = new toys.ToyRoom();
  const rack = { x: 0, y: 0 };
  for (const [player, toy] of Object.entries(holds)) {
    const taken = room.take(player, toy, 10, 10, rack, false);
    assert.equal(taken.ok, true, `${player} ${toy}`);
  }
  return room;
}

const body = (id, x, y, extra = {}) => ({ id, x, y, r: 31, ...extra });

test("toys: taking only fills the hand; rack, floor, swap and snack rules", () => {
  const room = new toys.ToyRoom();
  const rack = { x: 1040, y: 50 };
  assert.deepEqual(room.take("momo", "hammer", 1040, 50 + toys.RACK_REACH + 1, rack, false), { ok: false, reason: "far" });
  assert.deepEqual(room.take("momo", "hammer", 1040, 94, rack, true), { ok: false, reason: "snack" });
  assert.deepEqual(room.take("momo", "sword", 1040, 94, rack, false), { ok: false, reason: "unknown" });
  assert.deepEqual(room.take("momo", "hammer", 1040, 94, rack, false), { ok: true, toy: "hammer", returned: "" });
  assert.equal(room.hand("momo"), "hammer");
  assert.deepEqual(room.take("yuki", "hammer", 1040, 94, rack, false), { ok: false, reason: "busy" });
  // Swapping at the rack puts the old toy back.
  assert.deepEqual(room.take("momo", "ball", 1040, 94, rack, false), { ok: true, toy: "ball", returned: "hammer" });
  assert.equal(room.where("hammer").at, "rack");
  assert.deepEqual(room.drop("momo", 500, 400), { ok: true, toy: "ball", x: 500, y: 400 });
  assert.equal(room.hand("momo"), "");
  room.take("yuki", "pillow", 1040, 94, rack, false);
  assert.deepEqual(room.take("yuki", "ball", 500, 400, rack, false), { ok: false, reason: "full" });
  assert.deepEqual(room.take("momo", "ball", 500, 400 + toys.PICK_REACH + 1, rack, false), { ok: false, reason: "far" });
  assert.deepEqual(room.take("momo", "ball", 520, 410, rack, false), { ok: true, toy: "ball", returned: "" });
  assert.deepEqual(room.putBack("momo", 1040, 300, rack), { ok: false, reason: "far" });
  assert.deepEqual(room.putBack("momo", 1040, 94, rack), { ok: true, toy: "ball" });
  assert.deepEqual(room.putBack("momo", 1040, 94, rack), { ok: false, reason: "empty" });
  // Held and dropped toys survive a save; leaving puts the held one back on the rack.
  room.take("momo", "hammer", 1040, 94, rack, false);
  room.drop("yuki", 300, 320);
  const woke = new toys.ToyRoom(room.save());
  assert.equal(woke.hand("momo"), "hammer");
  assert.deepEqual(woke.where("pillow"), { at: "floor", x: 300, y: 320 });
  assert.deepEqual(woke.view((id) => id !== "momo").toys.find((toy) => toy.id === "hammer"), { id: "hammer", at: "rack" });
  assert.equal(woke.release("momo").toy, "hammer");
  assert.equal(woke.where("hammer").at, "rack");
  const messy = new toys.ToyRoom(JSON.stringify({ hammer: { hand: "a" }, ball: { hand: "a" }, sword: { hand: "b" }, plane: { x: "1", y: 2 } }));
  assert.equal(messy.hand("a"), "hammer");
  assert.equal(messy.where("ball").at, "rack");
  assert.equal(messy.where("plane").at, "rack");
  assert.equal(new toys.ToyRoom("nope").where("hammer").at, "rack");
});

test("toys: per-player cooldown, per-target cap and reach", () => {
  const room = toyRoomWith({ a: "hammer", b: "pillow" });
  const target = body("t", 100, 60);
  const t0 = 1_000_000;
  assert.deepEqual(room.hit(body("a", 100, 0), target, "pillow", t0), { ok: false, reason: "wrong" });
  assert.deepEqual(room.hit(body("a", 100, 0), body("a", 100, 0), "hammer", t0), { ok: false, reason: "self" });
  assert.deepEqual(room.hit(body("a", 100, 0), null, "hammer", t0), { ok: false, reason: "none" });
  assert.deepEqual(room.hit(body("a", 100, 0), body("t", 100, 31 + 31 + toys.HIT_GAP + 1), "hammer", t0), { ok: false, reason: "far" });
  assert.deepEqual(room.hit(body("a", 100, 0), target, "hammer", t0), { ok: true, to: "t" });
  assert.deepEqual(room.hit(body("a", 100, 0), target, "hammer", t0 + toys.TOY_COOLDOWN_MS.hammer - 1), { ok: false, reason: "cool" });
  assert.deepEqual(room.hit(body("a", 100, 0), target, "hammer", t0 + toys.TOY_COOLDOWN_MS.hammer), { ok: true, to: "t" });
  // The cap counts every hit on one person, from anyone, inside the window.
  const capped = new toys.ToyRoom();
  const rack = { x: 0, y: 0 };
  for (let i = 0; i < toys.TARGET_CAP + 1; i++) capped.take(`p${i}`, ["hammer", "ball", "plane", "pillow", "pinch", "ram"][i % 6], 0, 0, rack, false);
  let landed = 0;
  for (let i = 0; i < toys.TARGET_CAP + 4; i++) {
    const who = `x${i}`;
    capped.release(`p${i % 6}`);
    capped.take(who, "hammer", 0, 0, rack, false);
    const result = capped.hit(body(who, 100, 0), target, "hammer", t0 + i);
    if (result.ok) landed += 1;
    else assert.equal(result.reason, "capped");
    capped.release(who);
  }
  assert.equal(landed, toys.TARGET_CAP);
  capped.take("late", "hammer", 0, 0, rack, false);
  assert.equal(capped.hit(body("late", 100, 0), target, "hammer", t0 + toys.TARGET_WINDOW_MS + 10).ok, true);
  // Another person is not capped by someone else's hits.
  capped.release("late");
  capped.take("late2", "hammer", 0, 0, rack, false);
  assert.equal(capped.hit(body("late2", 100, 0), body("other", 100, 60), "hammer", t0 + 20).ok, true);
});

test("toys: the catch window is enforced by the server and a missed ball drops", () => {
  const room = toyRoomWith({ a: "ball" });
  const t0 = 5_000;
  const thrower = body("a", 100, 100);
  const catcher = body("b", 300, 100);
  const drop = { x: 330, y: 100 };
  assert.deepEqual(room.throwBall(thrower, body("b", 100 + toys.THROW_REACH + 1, 100), t0, () => drop), { ok: false, reason: "far" });
  const thrown = room.throwBall(thrower, catcher, t0, (who, nx, ny) => {
    assert.equal(who.id, "b");
    assert.ok(nx > 0 && ny === 0);
    return drop;
  });
  assert.deepEqual(thrown, { ok: true, to: "b", ms: toys.BALL_FLIGHT_MS, drop, combo: 0 });
  assert.equal(room.hand("a"), "");
  assert.equal(room.where("ball").at, "air");
  assert.deepEqual(new toys.ToyRoom(room.save()).where("ball"), { at: "floor", x: 330, y: 100 });
  assert.deepEqual(room.catchBall("c", t0 + 500), { ok: false, reason: "none" });
  assert.deepEqual(room.catchBall("b", t0 + toys.CATCH_OPEN_MS - 1), { ok: false, reason: "early" });
  assert.deepEqual(room.catchBall("b", t0 + 500, true), { ok: false, reason: "snack" });
  assert.deepEqual(room.catchBall("b", t0 + toys.CATCH_OPEN_MS), { ok: true, combo: 1, by: "a" });
  assert.equal(room.hand("b"), "ball");
  // Throw back: a catch at the last allowed moment keeps the combo going.
  const t1 = t0 + 2000;
  room.throwBall(body("b", 300, 100), body("a", 100, 100), t1, () => ({ x: 90, y: 100 }));
  const last = t1 + toys.BALL_FLIGHT_MS + toys.CATCH_GRACE_MS;
  assert.equal(room.nextDeadline(), last);
  assert.deepEqual(room.catchBall("a", last), { ok: true, combo: 2, by: "b" });
  // Nobody catches: past the window the catch is refused and settle drops the ball and resets the combo.
  const t2 = t1 + 4000;
  assert.deepEqual(room.throwBall(body("a", 100, 100), catcher, t2, () => drop).ok, true);
  assert.deepEqual(room.throwBall(body("a", 100, 100), catcher, t2 + 1, () => drop), { ok: false, reason: "wrong" });
  assert.deepEqual(room.settle(t2 + 1000).dropped, null);
  assert.deepEqual(room.catchBall("b", t2 + toys.BALL_FLIGHT_MS + toys.CATCH_GRACE_MS + 1), { ok: false, reason: "late" });
  assert.deepEqual(room.settle(t2 + toys.BALL_FLIGHT_MS + toys.CATCH_GRACE_MS + 1).dropped, { x: 330, y: 100, to: "b" });
  assert.deepEqual(room.where("ball"), { at: "floor", x: 330, y: 100 });
  assert.equal(room.view().combo, 0);
  assert.equal(room.nextDeadline(), null);
  assert.deepEqual(room.take("b", "ball", 320, 100, null, false).ok, true);
});

test("toys: paper plane needs text, pinch is capped by the server", () => {
  const room = toyRoomWith({ a: "plane", b: "pinch" });
  const t0 = 9_000;
  assert.deepEqual(room.plane(body("a", 0, 0), body("c", 200, 0), null, t0), { ok: false, reason: "empty" });
  assert.deepEqual(room.plane(body("a", 0, 0), body("c", toys.PLANE_REACH + 1, 0), "hi", t0), { ok: false, reason: "far" });
  assert.deepEqual(room.plane(body("a", 0, 0), body("c", 200, 0), "hi", t0), { ok: true, to: "c" });
  assert.deepEqual(room.plane(body("a", 0, 0), body("c", 200, 0), "hi", t0 + 10), { ok: false, reason: "cool" });
  const started = room.pinchStart(body("b", 0, 0), body("c", 70, 0), t0);
  assert.deepEqual(started, { ok: true, to: "c", ms: toys.PINCH_MAX_MS });
  assert.deepEqual(room.pinchStart(body("b", 0, 0), body("c", 70, 0), t0 + toys.TOY_COOLDOWN_MS.pinch), { ok: false, reason: "busy" });
  assert.equal(room.pinchEnd("c"), null);
  assert.equal(room.settle(t0 + toys.PINCH_MAX_MS - 1).pinch, null);
  assert.deepEqual(room.settle(t0 + toys.PINCH_MAX_MS).pinch, { by: "b", to: "c", until: t0 + toys.PINCH_MAX_MS });
  assert.equal(room.pinchOf("c"), null);
  const again = room.pinchStart(body("b", 0, 0), body("c", 70, 0), t0 + 5000);
  assert.equal(again.ok, true);
  assert.equal(room.pinchEnd("b").to, "c");
  // The server cuts plane text with the chat cleanup.
  const source = readFileSync(join(import.meta.dirname, "../src/office-room.ts"), "utf8");
  assert.match(source, /const text = normalizeChat\(body\.text\);\s*const result = this\.toys\.plane\(/);
  assert.equal([...content.normalizeChat("好".repeat(120))].length, 80);
});

test("toys: running is told from walking by the server's own move samples", () => {
  const room = new toys.ToyRoom();
  const walk = (id, speed, start, count = 8) => {
    for (let i = 0; i < count; i++) room.track(id, 100 + (speed * i * 90) / 1000, 100, start + i * 90);
    return start + (count - 1) * 90;
  };
  const walked = walk("slow", 170, 0);
  assert.equal(room.running("slow", walked + 10), false);
  const ran = walk("fast", 280, 0);
  assert.equal(room.running("fast", ran + 10), true);
  assert.equal(room.running("fast", ran + 400), false, "a stale run does not count");
  room.track("one", 0, 0, 0);
  assert.equal(room.running("one", 10), false);
});

test("toys: knockback stays out of walls, furniture, the map edge and other people", () => {
  const office = content.buildOffice();
  const solids = office.furniture.filter((item) => content.FURNITURE[item.kind]?.solid && item.kind !== "chair");
  const floor = (bodies = [], mine = 31) => toys.openFloor({ walls: office.walls, props: office.props, furniture: solids, bodies, bodyRadius: mine });
  const clear = floor();
  // Open floor in the middle of the office area: full distance.
  const open = { x: 15 * 32, y: 17 * 32 };
  assert.deepEqual(toys.knockSpot(open, 1, 0, clear), { x: open.x + 64, y: open.y });
  // Next to the outer wall the slide is cut short, never into or past the wall.
  const nearWall = { x: 32 + 11 + 20, y: 17 * 32 };
  const short = toys.knockSpot(nearWall, -1, 0, clear);
  assert.equal(short, null, "only 20px of room is less than the shortest knock");
  const roomy = { x: 32 + 11 + 45, y: 17 * 32 };
  const cut = toys.knockSpot(roomy, -1, 0, clear);
  assert.ok(cut && cut.x < roomy.x && cut.x - 11 >= 32, JSON.stringify(cut));
  assert.equal(content.hitsWall(office.walls, cut.x, cut.y, content.WALL_RADIUS), false);
  // The map edge counts as a wall too.
  assert.equal(clear(-5, 100), false);
  assert.equal(clear(content.COLS * 32 + 5, 100), false);
  // Toward a desk: the whole path must be clear, so it stops short or not at all.
  const desk = office.props.find((prop) => prop.kind === "desk");
  const front = { x: desk.x + desk.w / 2, y: desk.y + desk.h + 11 + 30 };
  const toDesk = toys.knockSpot(front, 0, -1, clear);
  assert.ok(toDesk === null || toDesk.y - 11 >= desk.y + desk.h, JSON.stringify(toDesk));
  assert.equal(clear(desk.x + desk.w / 2, desk.y + desk.h / 2), false);
  // Solid furniture such as the toy rack and snack machines blocks too.
  const rack = office.furniture.find((item) => item.id === toys.TOY_RACK_ID);
  assert.equal(rack.kind, "toyrack");
  assert.equal(content.FURNITURE.toyrack.fixed, true);
  assert.equal(clear(rack.x + 24, rack.y + 14), false);
  // Another person in the way blocks the landing spot.
  const crowded = floor([{ id: "x", x: open.x + 70, y: open.y, r: 31 }]);
  const blocked = toys.knockSpot(open, 1, 0, crowded);
  assert.ok(blocked === null || Math.hypot(blocked.x - (open.x + 70), blocked.y - open.y) >= 62 - 1, JSON.stringify(blocked));
  assert.equal(toys.knockSpot(open, 0, 0, clear), null);
  assert.equal(toys.knockSpot({ x: NaN, y: 0 }, 1, 0, clear), null);
});

test("toys: ramming needs the car, a run, a standing target, and only knocks once per window", () => {
  const room = toyRoomWith({ a: "ram", c: "hammer" });
  const run = (start) => {
    for (let i = 0; i < 8; i++) room.track("a", 100, 100 + (280 * i * 90) / 1000, start + i * 90);
    return start + 7 * 90 + 10;
  };
  const spot = { x: 100, y: 300 };
  const find = () => spot;
  const target = body("b", 100, 100 + 62);
  assert.deepEqual(room.ram(body("a", 100, 100), target, 0, find), { ok: false, reason: "walking" });
  let now = run(0);
  const attacker = body("a", 100, 100);
  assert.deepEqual(room.ram(body("a", 100, 100, { seated: true }), target, now, find), { ok: false, reason: "seated" });
  assert.deepEqual(room.ram(attacker, body("b", 100, 162, { seated: true }), now, find), { ok: false, reason: "seated" });
  assert.deepEqual(room.ram(attacker, body("b", 100, 100 + 31 + 31 + toys.RAM_GAP + 1), now, find), { ok: false, reason: "far" });
  assert.deepEqual(room.ram(body("c", 100, 100), target, now, find), { ok: false, reason: "wrong" });
  const hit = room.ram(attacker, target, now, (who, nx, ny) => {
    assert.equal(who.id, "b");
    assert.ok(Math.abs(nx) < 1e-9 && Math.abs(ny - 1) < 1e-9);
    return spot;
  });
  assert.deepEqual(hit, { ok: true, to: "b", spot, nx: 0, ny: 1 });
  assert.equal(room.ram(attacker, target, now + 10, find).reason, "cool");
  // A second ram inside the knock window only wobbles; no position comes back.
  now = run(now + toys.TOY_COOLDOWN_MS.ram);
  const wobble = room.ram(attacker, target, now, () => assert.fail("must not look for a spot"));
  assert.equal(wobble.ok, true);
  assert.equal(wobble.spot, null);
  // No valid spot: still ok, just a wobble.
  now = run(now + toys.KNOCK_WINDOW_MS);
  const nowhere = room.ram(attacker, body("d", 100, 162), now, () => null);
  assert.equal(nowhere.ok, true);
  assert.equal(nowhere.spot, null);
});

test("toys: the rack is fixed furniture in the game room and the client lists every toy", () => {
  const office = content.buildOffice();
  const rack = office.furniture.find((item) => item.id === toys.TOY_RACK_ID);
  const zone = office.zones.find((item) => item.id === "game");
  const size = content.furnitureSize(rack.kind, rack.rot);
  assert.ok(rack.x >= zone.x * 32 && rack.x + size.w <= (zone.x + zone.w) * 32 && rack.y >= zone.y * 32 && rack.y + size.h <= (zone.y + zone.h) * 32);
  assert.equal(content.furnitureFits(office.walls, rack.kind, rack.x, rack.y, rack.rot), true);
  for (const prop of office.props.filter((item) => item.solid)) assert.equal(overlap({ x: rack.x, y: rack.y, w: size.w, h: size.h }, prop), false, prop.kind);
  const source = readFileSync(join(import.meta.dirname, "../src/office-room.ts"), "utf8");
  assert.match(source, /isFixedId\(id\) \|\| id === TOY_RACK_ID/);
  assert.match(source, /isFixedKind\(kind\) \|\| kind === "toyrack"/);
  const client = readFileSync(join(import.meta.dirname, "../public/office/toys.js"), "utf8");
  for (const item of toys.TOY_ITEMS) assert.match(client, new RegExp(`id: "${item.id}"`));
  const furnish = readFileSync(join(import.meta.dirname, "../public/office/furnish.js"), "utf8");
  const license = readFileSync(join(import.meta.dirname, "../public/office/assets/kenney/LICENSE.txt"), "utf8");
  for (const name of ["bookcaseOpenLow", "bear", "tool-hammer", "ball-red", "vehicle-racer", "pillow"]) {
    assert.match(furnish, new RegExp(`"${name}"`));
    assert.equal(existsSync(join(import.meta.dirname, "../public/office/assets/kenney", `${name}.glb`)), true, name);
    assert.match(license, new RegExp(name.replace("-", "\\-")), name);
  }
});

test("emergency reset spots avoid solid furniture and props", () => {
  const props = [{ x: 0, y: 0, w: 40, h: 40, solid: true }, { x: 100, y: 0, w: 40, h: 40, solid: false }];
  const furniture = [
    { kind: "coffeetable", x: 200, y: 0, rot: 0 },
    { kind: "chair", x: 300, y: 0, rot: 0 },
    { kind: "bin", x: 400, y: 0, rot: 0 },
  ];
  assert.equal(content.hitsSolid(props, furniture, 20, 20, 10), true);
  assert.equal(content.hitsSolid(props, furniture, 50, 20, 12), true);
  assert.equal(content.hitsSolid(props, furniture, 120, 20, 10), false);
  assert.equal(content.hitsSolid(props, furniture, 240, 20, 10), true);
  assert.equal(content.hitsSolid(props, furniture, 316, 13, 10), false);
  assert.equal(content.hitsSolid(props, furniture, 408, 10, 10), false);
  assert.equal(content.hitsSolid(props, [{ kind: "coffeetable", x: 200, y: 0, rot: 90 }], 235, 60, 4), true);
  const room = readFileSync(join(import.meta.dirname, "../src/office-room.ts"), "utf8");
  const reset = room.slice(room.indexOf("private onReset("), room.indexOf("private onRise("));
  assert.match(reset, /RESET_COOLDOWN_MS/);
  assert.match(reset, /UPDATE furniture SET x = \?, y = \?, rot = \? WHERE id = \?/);
  assert.match(reset, /separateFrom\(att\.id, base\.x, base\.y, att\.look, true\)/);
});

test("Lala restocks only the empty snacks and says so", () => {
  const room = new snacks.SnackRoom(JSON.stringify({ cookie: 0, tea: 2, juice: 0 }));
  const far = room.restock(0, 0, { x: 400, y: 0 });
  assert.equal(far.ok, false);
  assert.equal(far.reason, "far");
  assert.equal(room.view().cookie, 0);
  const near = room.restock(10, 10, { x: 10, y: 80 });
  assert.equal(near.ok, true);
  assert.equal(near.changed, true);
  assert.equal(near.line, "好的，馬上幫你補上！");
  assert.equal(near.stock.cookie, snacks.SNACK_FULL);
  assert.equal(near.stock.juice, snacks.SNACK_FULL);
  assert.equal(near.stock.tea, 2);
  assert.equal(near.stock.soda, snacks.SNACK_FULL);
  const again = room.restock(10, 20, { x: 10, y: 10 });
  assert.equal(again.ok, true);
  assert.equal(again.changed, false);
  assert.equal(again.line, "零食和飲料都還有喔。");
  assert.equal(again.stock.tea, 2);
  const messy = new snacks.SnackRoom("nope");
  assert.equal(messy.view().marsh, snacks.SNACK_FULL);
  const weird = new snacks.SnackRoom(JSON.stringify({ cookie: -3, latte: 9 }));
  assert.equal(weird.view().cookie, snacks.SNACK_FULL);
  assert.equal(weird.view().latte, snacks.SNACK_FULL);
});

test("sofa table can move like other furniture while snack machines stay fixed", () => {
  const office = content.buildOffice();
  const table = office.furniture.find((item) => item.id === "sofa-table");
  const chair = office.furniture.find((item) => item.kind === "chair" && item.id.startsWith("desk-"));
  assert.ok(table && chair);
  assert.equal(table.kind, "coffeetable");
  assert.equal(Boolean(content.FURNITURE.coffeetable.fixed), false);
  assert.equal(Boolean(content.FURNITURE.chair.fixed), false);
  assert.equal(content.FURNITURE.snackcab.fixed, true);
  assert.equal(content.FURNITURE.vendor.fixed, true);
  assert.equal(snacks.isFixedKind("coffeetable"), false);
  assert.equal(snacks.isFixedId("sofa-table"), false);
  assert.equal(snacks.isFixedKind("snackcab"), true);
  assert.equal(snacks.isFixedId("snack-cabinet"), true);
  assert.equal(snacks.isFixedKind("vendor"), true);
  assert.equal(content.FURNITURE.coffeetable.solid, true);
  assert.equal(content.palette().find((item) => item.kind === "coffeetable").fixed, false);
  assert.equal(content.palette().find((item) => item.kind === "snackcab").fixed, true);
  assert.equal(content.palette().find((item) => item.kind === "vendor").fixed, true);
  assert.equal(office.props.some((item) => item.kind === "coffeetable"), false);
  assert.equal(content.furnitureFits(office.walls, table.kind, table.x, table.y, table.rot), true);
  assert.equal(content.furnitureFits(office.walls, "coffeetable", 0, 0, 0), false);
  assert.equal(content.furnitureFits(office.walls, "chair", 0, 0, 0), false);
  const nextX = Math.round((table.x + 48) / 4) * 4;
  const nextY = Math.round((table.y - 16) / 4) * 4;
  assert.notEqual(nextX, table.x);
  assert.equal(content.furnitureFits(office.walls, table.kind, nextX, nextY, table.rot), true);
  const size = content.furnitureSize(table.kind, table.rot);
  const chairSize = content.furnitureSize(chair.kind, chair.rot);
  assert.ok(size && chairSize);
  const home = { x: table.x, y: table.y, w: size.w, h: size.h };
  const shifted = { x: nextX, y: nextY, w: size.w, h: size.h };
  assert.equal(overlap(home, shifted), true);
  assert.notEqual(shifted.x, home.x);
  for (const machine of ["snack-cabinet", "snack-vendor"]) {
    const item = office.furniture.find((row) => row.id === machine);
    const box = content.furnitureSize(item.kind, item.rot);
    const spot = { x: item.x, y: item.y, w: box.w, h: box.h };
    assert.equal(overlap(shifted, spot), false, machine);
    assert.equal(overlap(home, spot), false, machine);
  }
  const page = readFileSync(join(import.meta.dirname, "../public/index.html"), "utf8");
  const client = readFileSync(join(import.meta.dirname, "../public/office/game.js"), "utf8");
  assert.match(page, /id="unstuck-btn"[^>]*aria-label="緊急急救"[^>]*>.*<span class="label">緊急急救<\/span><\/button>/);
  assert.match(client, /t: "reset"/);
  assert.match(client, /已回到安全位置/);
});

test("snack machines sit in the sofa area without covering the seats", () => {
  const office = content.buildOffice();
  const cabinet = office.furniture.find((item) => item.id === "snack-cabinet");
  const vendor = office.furniture.find((item) => item.id === "snack-vendor");
  assert.ok(cabinet && vendor);
  assert.equal(cabinet.rot, 180);
  assert.equal(vendor.rot, 180);
  assert.equal(content.FURNITURE.snackcab.fixed, true);
  assert.equal(content.FURNITURE.vendor.fixed, true);
  const zone = office.zones.find((item) => item.id === "sofa");
  const boxes = office.furniture.map((item) => {
    const size = content.furnitureSize(item.kind, item.rot);
    return { id: item.id, kind: item.kind, x: item.x, y: item.y, w: size.w, h: size.h };
  });
  const cab = boxes.find((item) => item.id === "snack-cabinet");
  const vend = boxes.find((item) => item.id === "snack-vendor");
  for (const item of [cab, vend]) {
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    assert.ok(cx >= zone.x * 32 && cx < (zone.x + zone.w) * 32, item.id);
    assert.ok(cy >= zone.y * 32 && cy < (zone.y + zone.h) * 32, item.id);
  }
  assert.equal(overlap(cab, vend), false);
  for (const other of boxes) {
    if (other.id === cab.id || other.id === vend.id) continue;
    assert.equal(overlap(cab, other), false, cab.id + " " + other.id);
    assert.equal(overlap(vend, other), false, vend.id + " " + other.id);
  }
  const table = boxes.find((item) => item.id === "sofa-table");
  assert.ok(table);
  assert.equal(overlap(cab, table), false);
  assert.equal(overlap(vend, table), false);
  assert.equal(office.props.some((item) => item.kind === "coffeetable"), false);
  const client = readFileSync(join(import.meta.dirname, "../public/office/snacks.js"), "utf8");
  for (const item of snacks.SNACK_ITEMS) {
    assert.match(client, new RegExp(`id: "${item.id}"`));
    assert.match(client, new RegExp(item.label));
  }
});

test("lounge sofas face the coffee table from the side", () => {
  const office = content.buildOffice();
  const table = office.furniture.find((item) => item.id === "sofa-table");
  const tableSize = content.furnitureSize(table.kind, table.rot);
  const tx = table.x + tableSize.w / 2;
  const ty = table.y + tableSize.h / 2;
  for (const id of ["sofa-left", "sofa-right"]) {
    const sofa = office.furniture.find((item) => item.id === id);
    const size = content.furnitureSize(sofa.kind, sofa.rot);
    const forward = content.layoutForward(sofa.rot);
    const rad = ((((sofa.rot % 360) + 360) % 360) * Math.PI) / 180;
    assert.ok(Math.abs(forward.x - Math.sin(rad)) < 1e-9, id);
    assert.ok(Math.abs(forward.y - Math.cos(rad)) < 1e-9, id);
    assert.ok(Math.abs(forward.y) < 1e-9, id);
    const cx = sofa.x + size.w / 2;
    const cy = sofa.y + size.h / 2;
    assert.ok(forward.x * (tx - cx) > 0, id);
    assert.ok(Math.abs(tx - cx) > Math.abs(ty - cy), id);
    const approach = content.seatApproach(sofa, size);
    const centerDist = Math.hypot(tx - cx, ty - cy);
    const approachDist = Math.hypot(tx - approach.x, ty - approach.y);
    assert.ok(approachDist < centerDist, id);
  }
  assert.equal(office.furniture.find((item) => item.id === "sofa-left").rot, 90);
  assert.equal(office.furniture.find((item) => item.id === "sofa-right").rot, 270);
});

test("only the old right sofa turns to face the coffee table", async () => {
  const { db, sql } = officeDb();
  sql.transaction(() => migrations.ensureTables(sql));
  sql.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '7')`);
  sql.exec(`INSERT INTO furniture (id, kind, x, y, rot) VALUES ('sofa-right', 'sofa', 1160, 840, 90)`);
  sql.exec(`INSERT INTO furniture (id, kind, x, y, rot) VALUES ('sofa-left', 'sofa', 992, 840, 90)`);
  sql.exec(`INSERT INTO furniture (id, kind, x, y, rot) VALUES ('sofa-moved', 'sofa', 1100, 840, 90)`);
  await migrations.runMigrations(sql, [], async (token) => token);
  assert.equal(sql.exec(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0].value, "8");
  assert.equal(Number(sql.exec(`SELECT rot FROM furniture WHERE id = 'sofa-right'`).toArray()[0].rot), 270);
  assert.equal(Number(sql.exec(`SELECT rot FROM furniture WHERE id = 'sofa-left'`).toArray()[0].rot), 90);
  assert.equal(Number(sql.exec(`SELECT rot FROM furniture WHERE id = 'sofa-moved'`).toArray()[0].rot), 90);
  db.close();
});

test("both restrooms have toilets and doors, and only the men's room has urinals", () => {
  const office = content.buildOffice();
  const props = office.props;
  const toilets = props.filter((item) => item.kind === "toilet");
  assert.equal(toilets.filter((item) => item.room === "men").length, 2);
  assert.equal(toilets.filter((item) => item.room === "women").length, 2);
  const urinals = props.filter((item) => item.kind === "urinal");
  assert.equal(urinals.length, 2);
  assert.ok(urinals.every((item) => item.room === "men"));
  assert.equal(props.filter((item) => item.kind === "urinal" && item.room === "women").length, 0);
  const doors = props.filter((item) => item.kind === "stalldoor").map((item) => item.id).sort();
  assert.deepEqual(doors, ["men-a", "men-b", "women-a", "women-b"]);
  const hall = office.zones.find((item) => item.id === "hall");
  const hallBox = { x: hall.x * 32, y: hall.y * 32, w: hall.w * 32, h: hall.h * 32 };
  for (const prop of props) {
    if (!["stallwall", "stalldoor", "toilet", "urinal"].includes(prop.kind)) continue;
    assert.equal(overlap(prop, hallBox), false, prop.id);
  }
  const room = new stalls.StallDoors();
  assert.equal(room.toggle("men-a", 0, 0).ok, false);
  assert.equal(room.toggle("nope", 96, 940).reason, "unknown");
  const door = props.find((item) => item.id === "men-a");
  const opened = room.toggle("men-a", door.x + door.w / 2, door.y - 30);
  assert.equal(opened.ok, true);
  assert.equal(opened.open, true);
  const closedCenter = { x: door.x + door.w / 2, y: door.y + door.h / 2 };
  const openCenter = { x: door.openX + door.openW / 2, y: door.openY + door.openH / 2 };
  assert.equal(room.blocks(closedCenter.x, closedCenter.y, 11), false);
  assert.equal(room.blocks(openCenter.x, openCenter.y, 11), true);
  const shut = room.toggle("men-a", door.x + door.w / 2, door.y - 30);
  assert.equal(shut.open, false);
  assert.equal(room.blocks(closedCenter.x, closedCenter.y, 11), true);
  assert.equal(room.blocks(openCenter.x, openCenter.y, 11), false);
  assert.equal(stalls.STALL_COOLDOWN_MS, 300);
  const officeRoom = readFileSync(join(import.meta.dirname, "../src/office-room.ts"), "utf8");
  assert.match(officeRoom, /STALL_COOLDOWN_MS/);
  assert.match(officeRoom, /this\.stalls\.load\(this\.meta\(STALL_META\)\)/);
  assert.match(officeRoom, /setMeta\(STALL_META, this\.stalls\.save\(\)\)/);
  const furnish = readFileSync(join(import.meta.dirname, "../public/office/furnish.js"), "utf8");
  for (const name of ["toilet", "doorway", "wall"]) {
    assert.match(furnish, new RegExp(`"${name}"`));
    assert.equal(existsSync(join(import.meta.dirname, "../public/office/assets/kenney", `${name}.glb`)), true, name);
  }
  const license = readFileSync(join(import.meta.dirname, "../public/office/assets/kenney/LICENSE.txt"), "utf8");
  for (const name of ["toiletSquare", "doorwayFront", "wallDoorway", "wallDoorwayWide"]) {
    assert.doesNotMatch(furnish, new RegExp(`"${name}"`));
    assert.equal(existsSync(join(import.meta.dirname, "../public/office/assets/kenney", `${name}.glb`)), false, name);
    assert.doesNotMatch(license, new RegExp(`\\b${name}\\b`));
  }
  assert.doesNotMatch(license, /license says 2\.0/);
  const client = readFileSync(join(import.meta.dirname, "../public/office/stalls.js"), "utf8");
  assert.match(client, /Kenney Furniture Kit/);
  assert.match(client, /bowl/);
});

test("stall doors refuse to swing onto someone standing in the frame", () => {
  const room = new stalls.StallDoors();
  const door = stalls.stallProps().find((item) => item.id === "men-a");
  const knock = { x: door.x + door.w / 2, y: door.y - 30 };
  const inFrame = { x: door.x + door.w / 2, y: door.y + door.h / 2 };
  const inSwing = { x: door.openX + door.openW / 2, y: door.openY + door.openH / 2 };
  assert.deepEqual(room.toggle("men-a", knock.x, knock.y, [knock, inSwing], 11), { ok: false, reason: "busy" });
  assert.equal(room.isOpen("men-a"), false);
  assert.equal(room.toggle("men-a", knock.x, knock.y, [knock, inFrame], 11).ok, true);
  assert.equal(room.isOpen("men-a"), true);
  assert.deepEqual(room.toggle("men-a", knock.x, knock.y, [knock, inFrame], 11), { ok: false, reason: "busy" });
  assert.equal(room.isOpen("men-a"), true);
  assert.equal(room.blocks(inFrame.x, inFrame.y, 11), false);
  assert.equal(room.toggle("men-a", knock.x, knock.y, [knock, { x: inFrame.x, y: inFrame.y - 60 }], 11).ok, true);
  assert.equal(room.isOpen("men-a"), false);
});

test("stall doors survive a save and load round trip", () => {
  const room = new stalls.StallDoors();
  const door = stalls.stallProps().find((item) => item.id === "women-b");
  room.toggle("women-b", door.x + door.w / 2, door.y - 30);
  const saved = room.save();
  const back = new stalls.StallDoors();
  back.load(saved);
  assert.deepEqual(back.view(), room.view());
  assert.equal(back.isOpen("women-b"), true);
  back.load(JSON.stringify(["women-b", "nope", 3]));
  assert.deepEqual(back.view().filter((item) => item.open).map((item) => item.id), ["women-b"]);
  for (const bad of [null, "", "{", "{}", "7"]) {
    back.load(bad);
    assert.equal(back.view().some((item) => item.open), false, String(bad));
  }
  assert.equal(typeof stalls.STALL_META, "string");
});

test("holding a snack at a stall door, E toggles the door instead of eating", () => {
  const game = readFileSync(join(import.meta.dirname, "../public/office/game.js"), "utf8");
  const bite = game.match(/const blockBite = ([^;]+);/);
  assert.ok(bite, "找不到 blockBite");
  assert.match(bite[1], /stalls\.nearest\(\)/);
});

test("both restrooms have sinks along the wall, with a mirror above each one", () => {
  const office = content.buildOffice();
  const sinks = office.props.filter((item) => item.kind === "sink");
  const mirrors = office.props.filter((item) => item.kind === "mirror");
  assert.equal(sinks.filter((item) => item.room === "men").length, 2);
  assert.equal(sinks.filter((item) => item.room === "women").length, 2);
  assert.ok(sinks.every((item) => item.solid));
  assert.equal(mirrors.length, sinks.length);
  const zones = {
    men: office.zones.find((item) => item.id === "men"),
    women: office.zones.find((item) => item.id === "women"),
  };
  const stalls = office.props.filter((item) => ["stallwall", "stalldoor", "toilet", "urinal"].includes(item.kind));
  for (const sink of sinks) {
    const zone = zones[sink.room];
    const box = { x: zone.x * 32, y: zone.y * 32, w: zone.w * 32, h: zone.h * 32 };
    assert.ok(sink.x >= box.x && sink.y >= box.y && sink.x + sink.w <= box.x + box.w && sink.y + sink.h <= box.y + box.h, sink.id);
    assert.ok(stalls.every((part) => !overlap(sink, part)), `${sink.id} 擋到隔間`);
    const mirror = mirrors.find((item) => item.id === `${sink.id}-mirror`);
    assert.ok(mirror, sink.id);
    assert.equal(mirror.room, sink.room);
    assert.equal(mirror.solid, false);
    assert.equal(mirror.x, sink.x);
    assert.ok(mirror.y <= sink.y, `${sink.id} 鏡子不在洗手台靠牆的那一側`);
    assert.ok(mirror.y + mirror.h <= sink.y + sink.h, `${sink.id} 鏡子超出洗手台`);
  }
  for (const other of sinks) {
    const hits = sinks.filter((item) => item !== other && overlap(item, other));
    assert.equal(hits.length, 0, other.id);
  }
  const doorTiles = [
    [4, 25],
    [5, 25],
    [14, 25],
    [15, 25],
  ];
  for (const [tx, ty] of doorTiles) {
    const cx = tx * 32 + 16;
    const cy = ty * 32 + 16;
    assert.ok(sinks.every((sink) => cx < sink.x || cx > sink.x + sink.w || cy < sink.y || cy > sink.y + sink.h), `${tx},${ty}`);
  }
  const furnish = readFileSync(join(import.meta.dirname, "../public/office/furnish.js"), "utf8");
  assert.match(furnish, /"bathroomSink"/);
  assert.equal(existsSync(join(import.meta.dirname, "../public/office/assets/kenney/bathroomSink.glb")), true);
  const world = readFileSync(join(import.meta.dirname, "../public/office/world3d.js"), "utf8");
  assert.match(world, /bathroomSink/);
  assert.match(world, /bathroomMirror/);
});

test("snack cabinet keeps its body and the drinks machine can use the Kenney vending model", () => {
  const furnish = readFileSync(join(import.meta.dirname, "../public/office/furnish.js"), "utf8");
  const world = readFileSync(join(import.meta.dirname, "../public/office/world3d.js"), "utf8");
  const license = readFileSync(join(import.meta.dirname, "../public/office/assets/kenney/LICENSE.txt"), "utf8");
  for (const name of ["vending-machine", "plate", "cookie", "cupcake", "cup-tea", "donut"]) {
    assert.match(furnish, new RegExp(`"${name}"`));
    assert.equal(existsSync(join(import.meta.dirname, "../public/office/assets/kenney", `${name}.glb`)), true, name);
  }
  assert.match(world, /vending-machine/);
  assert.match(world, /afternoonTea/);
  assert.match(world, /roundedBox\(36, 34, 26/);
  assert.match(license, /Mini Arcade/);
  assert.match(license, /Food Kit/);
  assert.match(license, /CC0/);
  const client = readFileSync(join(import.meta.dirname, "../public/office/snacks.js"), "utf8");
  for (const item of snacks.SNACK_ITEMS) assert.match(client, new RegExp(`"${item.id}"`));
});

test("socket requests accept known kinds, safe ids and plain object bodies", () => {
  assert.equal(requests.requestKind("score"), "score");
  assert.equal(requests.requestKind("leaderboard"), "leaderboard");
  assert.equal(requests.requestKind("setup"), "setup");
  assert.equal(requests.requestKind("move"), null);
  assert.equal(requests.requestId("r12"), "r12");
  assert.equal(requests.requestId(""), null);
  assert.equal(requests.requestId(12), null);
  assert.equal(requests.requestId("x".repeat(33)), null);
  assert.equal(requests.requestId("a b"), null);
  assert.deepEqual(requests.requestBody(undefined), {});
  assert.deepEqual(requests.requestBody({ game: "zip" }), { game: "zip" });
  assert.equal(requests.requestBody(null), null);
  assert.equal(requests.requestBody([1]), null);
  assert.equal(requests.requestBody("zip"), null);
});

test("a socket reply keeps its request id and status, and a body cannot fake either", () => {
  assert.deepEqual(requests.reply("r1", { status: 200, data: { game: "zip", score: 2 } }), {
    game: "zip",
    score: 2,
    t: "reply",
    rid: "r1",
    status: 200,
    ok: true,
  });
  const bad = requests.reply("r2", { status: 429, data: { error: "太快了", rid: "r9", ok: true, t: "x" } });
  assert.equal(bad.rid, "r2");
  assert.equal(bad.t, "reply");
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 429);
});

test("page requests wait for the socket and each reply resolves its own promise", async () => {
  const box = createRequests({ timeoutMs: 1000 });
  const out = [];
  const board = box.ask("leaderboard");
  const score = box.ask("score", { game: "zip", op: "solve" });
  assert.equal(box.waiting, 2);
  box.open((payload) => out.push(payload));
  assert.deepEqual(out.map((item) => item.t), ["leaderboard", "score"]);
  assert.notEqual(out[0].rid, out[1].rid);
  assert.deepEqual(out[1].body, { game: "zip", op: "solve" });
  assert.equal(box.settle({ t: "reply", rid: out[1].rid, ok: true, status: 200, score: 1 }), true);
  assert.equal(box.settle({ t: "reply", rid: out[0].rid, ok: true, status: 200, games: [] }), true);
  assert.deepEqual(await score, { ok: true, status: 200, score: 1 });
  assert.deepEqual(await board, { ok: true, status: 200, games: [] });
  assert.equal(box.settle({ t: "reply", rid: "nobody", ok: true }), true);
  assert.equal(box.settle({ t: "welcome" }), false);
  assert.equal(box.waiting, 0);
});

test("a request already sent fails when the socket drops; one not sent yet, or refused by a closing socket, waits for the next socket", async () => {
  const box = createRequests({ timeoutMs: 1000 });
  const first = [];
  box.open((payload) => first.push(payload));
  const lost = box.ask("score", { game: "zip", op: "solve" });
  box.close();
  assert.deepEqual(await lost, { ok: false, status: 0, error: "連線中斷" });
  const later = box.ask("leaderboard");
  const second = [];
  box.open((payload) => second.push(payload));
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  box.settle({ t: "reply", rid: second[0].rid, ok: true, status: 200, games: [] });
  assert.equal((await later).ok, true);
  const gone = box.ask("leaderboard");
  box.close();
  box.drop();
  assert.equal((await gone).ok, false);
  const closing = box.ask("leaderboard");
  box.open(() => { throw new Error("closed"); });
  assert.equal(box.waiting, 1);
  const third = [];
  box.open((payload) => third.push(payload));
  box.settle({ t: "reply", rid: third[0].rid, ok: true, status: 200, games: [] });
  assert.equal((await closing).ok, true);
  const slow = createRequests({ timeoutMs: 5 });
  assert.deepEqual(await slow.ask("leaderboard"), { ok: false, status: 0, error: "辦公室沒有回應" });
  assert.equal(slow.waiting, 0);
});

test("the page path comes from the env var, normalized, and is off when unset or unsafe", () => {
  assert.equal(panel.normalizeSlug("/desk/panel"), "/desk/panel");
  assert.equal(panel.normalizeSlug("desk/panel/"), "/desk/panel");
  assert.equal(panel.normalizeSlug("  /desk//  "), "/desk");
  for (const bad of [undefined, "", "  ", "/", "///", "/a/../b", "/a//b", "/a b", "/api", "/api/x", "/a?b"]) {
    assert.equal(panel.normalizeSlug(bad), null, String(bad));
  }
});

test("the page and its files are served only under the configured path", async () => {
  const at = (path, method = "GET") => new Request(`https://office.test${path}`, { method });
  assert.equal(panel.panelResponse(at("/desk/panel/"), undefined), null);
  assert.equal(panel.panelResponse(at("/desk/panel/"), ""), null);
  assert.equal(panel.panelResponse(at("/other/"), "/desk/panel"), null);
  assert.equal(panel.panelResponse(at("/desk/panelx/"), "/desk/panel"), null);
  assert.equal(panel.panelResponse(at("/desk/panel/nope.js"), "/desk/panel"), null);
  assert.equal(panel.panelResponse(at("/desk/panel/", "POST"), "/desk/panel"), null);
  const bare = panel.panelResponse(at("/desk/panel"), "desk/panel/");
  assert.equal(bare.status, 302);
  assert.equal(bare.headers.get("location"), "https://office.test/desk/panel/");
  const page = panel.panelResponse(at("/desk/panel/"), "/desk/panel");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  const html = await page.text();
  assert.match(html, /href="panel\.css"/);
  assert.match(html, /src="panel\.js"/);
  const script = panel.panelResponse(at("/desk/panel/panel.js"), "/desk/panel");
  assert.match(script.headers.get("content-type"), /javascript/);
  assert.match(await script.text(), /signedIn/);
  const style = panel.panelResponse(at("/desk/panel/panel.css"), "/desk/panel");
  assert.match(style.headers.get("content-type"), /text\/css/);
  const head = panel.panelResponse(at("/desk/panel/", "HEAD"), "/desk/panel");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("the page files are not in the public assets and no old page path is written down", () => {
  const root = join(import.meta.dirname, "..");
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".git", ".wrangler", "test-results", "dist"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
  const publicFiles = walk(join(root, "public")).map((path) => path.slice(root.length));
  for (const name of ["panel.js", "panel.css"]) assert.equal(publicFiles.some((path) => path.endsWith(name)), false, name);
  const pageText = readFileSync(join(root, "panel/index.html"), "utf8");
  for (const path of walk(join(root, "public")).filter((file) => file.endsWith(".html"))) {
    assert.notEqual(readFileSync(path, "utf8"), pageText, path);
  }
  const old = ["office", "admin"].join("/");
  const oldPage = new RegExp(`(?<!api/)${old}|${["admin", "index\\.html"].join("/")}`);
  const texts = walk(root).filter((path) => /\.(ts|mjs|js|html|css|md|toml|json|yml|example)$/.test(path) && !path.includes("/vendor/") && !path.endsWith("package-lock.json"));
  for (const path of texts) assert.doesNotMatch(readFileSync(path, "utf8"), oldPage, path.slice(root.length));
});
