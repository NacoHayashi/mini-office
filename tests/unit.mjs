import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import test from "node:test";
import vm from "node:vm";
import esbuild from "esbuild";

// The room server, the office client, and the 3D scene are each split across
// several files by feature; source checks read each group back as one text.
function readSources(files) {
  return files.map((file) => readFileSync(join(import.meta.dirname, "..", file), "utf8")).join("\n");
}
const ROOM_FILES = ["base", "login", "admin", "scores", "seats", "toys", "snacks", "whisper", "furniture", "meeting", "pantry"]
  .map((name) => `src/room-${name}.ts`)
  .concat("src/office-room.ts");
const CLIENT_FILES = [
  "office-state", "net", "login", "movement", "input", "interact", "edit-mode", "whisper",
  "people", "chat", "actions", "arcade", "look-editor", "debug", "game",
].map((name) => `public/office/${name}.js`);
const WORLD_FILES = readdirSync(join(import.meta.dirname, "../public/office"))
  .filter((file) => file.startsWith("world") && file.endsWith(".js"))
  .map((file) => `public/office/${file}`);
const roomSource = () => readSources(ROOM_FILES);
const clientSource = () => readSources(CLIENT_FILES);
const worldSource = () => readSources(WORLD_FILES);

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
const telegramFile = join(outdir, "telegram-login.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/telegram-login.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: telegramFile,
});
const telegram = await import(pathToFileURL(telegramFile).href);
const guestFile = join(outdir, "guest-login.mjs");
await esbuild.build({
  entryPoints: [join(import.meta.dirname, "../src/guest-login.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: guestFile,
});
const guests = await import(pathToFileURL(guestFile).href);

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

test("帽子、頸部、手上配件各有自己的顏色", () => {
  const cat = content.presetLook("cat");
  for (const slot of ["head", "neck", "held"]) assert.equal(cat.colors[slot], "#f3eee3");
  const look = content.normalizeLook({ ...cat, colors: { ...cat.colors, head: "#F26D9A", neck: "#7aa6ee", held: "#3cb85c" } });
  assert.deepEqual([look.colors.head, look.colors.neck, look.colors.held], ["#f26d9a", "#7aa6ee", "#3cb85c"]);
  assert.equal(content.normalizeLook({ ...cat, colors: { ...cat.colors, neck: "#112233" } }), null);
  assert.equal(content.normalizeLook({ ...cat, colors: { ...cat.colors, held: 3 } }), null);
});

test("舊造型只有一個配件色時，每個配件都沿用它", () => {
  const { head, neck, held, ...old } = content.presetLook("cat").colors;
  const look = content.normalizeLook({ body: "bean", colors: { ...old, accessory: "#c9b6ff" } });
  assert.deepEqual([look.colors.accessory, look.colors.head, look.colors.neck, look.colors.held], ["#c9b6ff", "#c9b6ff", "#c9b6ff", "#c9b6ff"]);
  const mixed = content.normalizeLook({ colors: { accessory: "#c9b6ff", head: "#ffe08a" } });
  assert.deepEqual([mixed.colors.head, mixed.colors.neck, mixed.colors.held], ["#ffe08a", "#c9b6ff", "#c9b6ff"]);
  const none = content.normalizeLook({ body: "bean" });
  assert.deepEqual([none.colors.head, none.colors.neck, none.colors.held], ["#f3eee3", "#f3eee3", "#f3eee3"]);
  const stored = content.readStoredLook("custom", JSON.stringify({ v: 2, colors: { accessory: "#7aa6ee", neck: "#112233" } }));
  assert.ok(stored, "下架的配件色不該讓造型失效");
  assert.deepEqual([stored.colors.head, stored.colors.neck, stored.colors.held], ["#7aa6ee", "#f3eee3", "#7aa6ee"]);
});

test("眼鏡框維持深色，不跟著配件顏色", () => {
  const world = readFileSync(join(import.meta.dirname, "../public/office/avatar.js"), "utf8");
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
  assert.equal(sql.exec(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0].value, "10");
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
  assert.equal(sql.exec(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0].value, "10");
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
  assert.equal(sql.exec(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0].value, "10");
  sql.exec(`INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES ('old', 1, 50)`);
  sql.exec(`INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES ('fresh', 1, 5000)`);
  sql.exec(`DELETE FROM admin_sessions WHERE expires_at <= ?`, 100);
  assert.equal(sql.exec(`SELECT token_hash FROM admin_sessions`).toArray().map((row) => row.token_hash).join(","), "fresh");
  const room = roomSource();
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
  const game = clientSource();
  const bye = game.slice(game.indexOf('message.t === "bye"'), game.indexOf("function send("));
  assert.match(bye, /reason === "elsewhere"/);
  assert.match(bye, /password: "辦公室密碼已更新，請重新輸入。"/);
  assert.match(bye, /restored: "辦公室已還原，請重新輸入。"/);
  assert.match(bye, /showGate\(text\)/);
  const room = roomSource();
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
  const room2 = roomSource();
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
  assert.equal(messy.view().toys.length, toys.TOY_IDS.length);
  assert.equal(messy.view().toys.some((toy) => toy.id === "plane" || toy.id === "pinch"), false, "removed toys from old saves are ignored");
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
  for (let i = 0; i < toys.TARGET_CAP + 1; i++) capped.take(`p${i}`, toys.TOY_IDS[i % toys.TOY_IDS.length], 0, 0, rack, false);
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

test("toys: pinching needs no toy and is capped by the server", () => {
  const room = new toys.ToyRoom();
  const t0 = 9_000;
  assert.deepEqual(room.pinchStart(body("b", 0, 0), body("c", 31 + 31 + toys.HIT_GAP + 1, 0), t0), { ok: false, reason: "far" });
  assert.deepEqual(room.pinchStart(body("b", 0, 0), null, t0), { ok: false, reason: "none" });
  const started = room.pinchStart(body("b", 0, 0), body("c", 70, 0), t0);
  assert.deepEqual(started, { ok: true, to: "c", ms: toys.PINCH_MAX_MS });
  assert.equal(room.hand("b"), "", "nothing was taken from the rack");
  assert.deepEqual(room.pinchStart(body("b", 0, 0), body("c", 70, 0), t0 + toys.ACTION_COOLDOWN_MS.pinch), { ok: false, reason: "busy" });
  assert.equal(room.pinchEnd("c"), null);
  assert.equal(room.settle(t0 + toys.PINCH_MAX_MS - 1).pinch, null);
  assert.deepEqual(room.settle(t0 + toys.PINCH_MAX_MS).pinch, { by: "b", to: "c", until: t0 + toys.PINCH_MAX_MS });
  assert.equal(room.pinchOf("c"), null);
  const again = room.pinchStart(body("b", 0, 0), body("c", 70, 0), t0 + 5000);
  assert.equal(again.ok, true);
  assert.equal(room.pinchEnd("b").to, "c");
  // The paper plane is gone, so the server has no letter path left.
  const source = roomSource();
  assert.doesNotMatch(source, /plane|letter/i);
  assert.equal("plane" in toys.TOY_COOLDOWN_MS, false);
});

test("toys: every play toy needs to be in hand, has its own reach and cooldown", () => {
  assert.deepEqual(toys.TOY_IDS, ["hammer", "ball", "pillow", "bubble", "water", "wand", "ram"]);
  assert.equal(toys.TOY_IDS.length, new Set(toys.TOY_IDS).size);
  const t0 = 50_000;
  for (const toy of toys.PLAY_TOYS) {
    const room = toyRoomWith({ a: toy });
    const reach = toys.TOY_RANGE[toy] ?? 31 + 31 + toys.HIT_GAP;
    const by = body("a", 0, 0);
    assert.deepEqual(room.play(body("z", 0, 0), body("t", 40, 0), toy, t0), { ok: false, reason: "wrong" }, toy);
    assert.deepEqual(room.play(by, body("t", reach + 1, 0), toy, t0), { ok: false, reason: "far" }, toy);
    assert.deepEqual(room.play(by, body("t", reach, 0), toy, t0), { ok: true, to: "t" }, toy);
    assert.deepEqual(room.play(by, body("t", reach, 0), toy, t0 + toys.TOY_COOLDOWN_MS[toy] - 1), { ok: false, reason: "cool" }, toy);
    assert.equal(room.play(by, body("t", reach, 0), toy, t0 + toys.TOY_COOLDOWN_MS[toy]).ok, true, toy);
    assert.equal(toys.isPlayToy(toy), true);
  }
  assert.equal(toys.isPlayToy("ball"), false);
  assert.equal(toys.isPlayToy("ram"), false);
  for (const gone of ["popper", "horn", "frisbee", "blower"]) {
    assert.equal(toys.isPlayToy(gone), false, gone);
    assert.equal(toys.isToy(gone), false, gone);
  }
  // The server sends each play toy through the same path; hammer keeps its bonk.
  const source = roomSource();
  assert.match(source, /isPlayToy\(toy\)\) \{\s*const result = this\.toys\.play\(me, target, toy, now\);/);
  assert.match(source, /const kind = toy === "hammer" \? "bonk" : toy;/);
});

test("toys: bumping needs no toy, pushes along a clear path and stays server-side", () => {
  const room = new toys.ToyRoom();
  const t0 = 70_000;
  const spot = { x: 100, y: 260 };
  const find = (who, nx, ny) => {
    assert.equal(who.id, "b");
    assert.ok(Math.abs(nx) < 1e-9 && Math.abs(ny - 1) < 1e-9);
    return spot;
  };
  const me = body("a", 100, 100);
  assert.deepEqual(room.bump(me, body("b", 100, 100 + 31 + 31 + toys.HIT_GAP + 1), t0, find), { ok: false, reason: "far" });
  assert.deepEqual(room.bump(me, me, t0, find), { ok: false, reason: "self" });
  assert.deepEqual(room.bump(body("a", 100, 100, { seated: true }), body("b", 100, 160), t0, find), { ok: false, reason: "seated" });
  assert.deepEqual(room.bump(me, body("b", 100, 160, { seated: true }), t0, find), { ok: false, reason: "seated" });
  assert.deepEqual(room.bump(me, body("b", 100, 160), t0, find), { ok: true, to: "b", spot, nx: 0, ny: 1 });
  assert.equal(room.hand("a"), "");
  assert.equal(room.bump(me, body("b", 100, 160), t0 + 10, find).reason, "cool");
  // Inside the knock window a second bump from someone else only wobbles.
  const wobble = room.bump(body("c", 100, 100), body("b", 100, 160), t0 + 100, () => assert.fail("must not look for a spot"));
  assert.equal(wobble.ok, true);
  assert.equal(wobble.spot, null);
  const later = room.bump(body("c", 100, 100), body("b", 100, 160), t0 + toys.KNOCK_WINDOW_MS + toys.ACTION_COOLDOWN_MS.bump, () => spot);
  assert.deepEqual(later.spot, spot);
  // Real floor: a bump by hand slides farther than the car but never into a wall.
  const office = content.buildOffice();
  const solids = office.furniture.filter((item) => content.FURNITURE[item.kind]?.solid && item.kind !== "chair");
  const clear = toys.openFloor({ walls: office.walls, props: office.props, furniture: solids, bodies: [], bodyRadius: 31 });
  const open = { x: 15 * 32, y: 17 * 32 };
  assert.deepEqual(toys.knockSpot(open, 1, 0, clear, toys.BUMP_DISTANCES), { x: open.x + toys.BUMP_DISTANCES[0], y: open.y });
  const nearWall = { x: 32 + 11 + 30, y: 17 * 32 };
  const short = toys.knockSpot(nearWall, -1, 0, clear, toys.BUMP_DISTANCES);
  assert.ok(short && short.x < nearWall.x && content.hitsWall(office.walls, short.x, short.y, content.WALL_RADIUS) === false, JSON.stringify(short));
  // The server moves the person itself and drops their stale moves for a moment.
  const source = roomSource();
  assert.match(source, /op === "ram" \? this\.toys\.ram\(me, target, now, find\) : this\.toys\.bump\(me, target, now, find\)/);
  assert.match(source, /far \? BUMP_DISTANCES : KNOCK_DISTANCES/);
  assert.match(source, /protected knockTo\(id: string, spot: \{ x: number; y: number \}, now: number\) \{\s*const hit = this\.socketOf\(id\);\s*if \(!hit\) return;\s*hit\.att\.x = spot\.x;\s*hit\.att\.y = spot\.y;/);
});

test("toys: Lala puts floor toys and toys of people who left back on the rack", () => {
  const room = toyRoomWith({ a: "hammer", b: "wand", c: "water" });
  room.drop("a", 300, 300);
  const moved = room.tidy((id) => id === "c");
  assert.deepEqual(moved.sort(), ["hammer", "wand"]);
  assert.equal(room.where("hammer").at, "rack");
  assert.equal(room.hand("b"), "");
  assert.equal(room.hand("c"), "water", "people still here keep their toy");
  assert.deepEqual(room.tidy(() => true), []);
  const source = roomSource();
  assert.match(source, /if \(op === "tidy"\) \{\s*if \(Math\.hypot\(att\.x - this\.map\.lala\.x, att\.y - this\.map\.lala\.y\) > LALA_REACH\)/);
  const client = readFileSync(join(import.meta.dirname, "../public/office/toys.js"), "utf8");
  assert.match(client, /send\(\{ t: "toy", op: "tidy" \}\)/);
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

test("toys: ramming needs the car, a drive, a standing target, and only knocks once per window", () => {
  const room = toyRoomWith({ a: "ram", c: "hammer" });
  const run = (start) => {
    for (let i = 0; i < 8; i++) room.track("a", 100, 100 + (170 * i * 90) / 1000, start + i * 90);
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
  // A bump on the same person inside the knock window only wobbles; no position comes back.
  const wobble = room.bump(body("e", 100, 100), target, now + 20, () => assert.fail("must not look for a spot"));
  assert.equal(wobble.ok, true);
  assert.equal(wobble.spot, null);
  // The car's cooldown outlasts the knock window, so the next ram knocks again.
  assert.ok(toys.TOY_COOLDOWN_MS.ram >= toys.KNOCK_WINDOW_MS);
  now = run(now + toys.TOY_COOLDOWN_MS.ram);
  assert.deepEqual(room.ram(attacker, target, now, find).spot, spot);
  // No valid spot: still ok, just a wobble.
  now = run(now + toys.TOY_COOLDOWN_MS.ram);
  const nowhere = room.ram(attacker, body("d", 100, 162), now, () => null);
  assert.equal(nowhere.ok, true);
  assert.equal(nowhere.spot, null);
  // Standing still in the car does nothing.
  const parked = toyRoomWith({ p: "ram" });
  for (let i = 0; i < 8; i++) parked.track("p", 100, 100, i * 90);
  assert.equal(parked.ram(body("p", 100, 100), target, 700, find).reason, "walking");
});

test("toys: the rack is fixed furniture in the game room and the client lists every toy", () => {
  const office = content.buildOffice();
  const rack = office.furniture.find((item) => item.id === toys.TOY_RACK_ID);
  const zone = office.zones.find((item) => item.id === "game");
  const size = content.furnitureSize(rack.kind, rack.rot);
  assert.ok(rack.x >= zone.x * 32 && rack.x + size.w <= (zone.x + zone.w) * 32 && rack.y >= zone.y * 32 && rack.y + size.h <= (zone.y + zone.h) * 32);
  assert.equal(content.furnitureFits(office.walls, rack.kind, rack.x, rack.y, rack.rot), true);
  for (const prop of office.props.filter((item) => item.solid)) assert.equal(overlap({ x: rack.x, y: rack.y, w: size.w, h: size.h }, prop), false, prop.kind);
  const source = roomSource();
  assert.match(source, /isFixedId\(id\) \|\| id === TOY_RACK_ID/);
  assert.match(source, /if \(FURNITURE\[kind\]\?\.fixed\)/);
  assert.equal(content.FURNITURE.toyrack.fixed, true);
  const client = readFileSync(join(import.meta.dirname, "../public/office/toys.js"), "utf8");
  for (const item of toys.TOY_ITEMS) assert.match(client, new RegExp(`id: "${item.id}"`));
  const furnish = readFileSync(join(import.meta.dirname, "../public/office/furnish.js"), "utf8");
  const license = readFileSync(join(import.meta.dirname, "../public/office/assets/kenney/LICENSE.txt"), "utf8");
  for (const name of ["bookcaseOpenLow", "vehicle-racer", "pillow"]) {
    assert.match(furnish, new RegExp(`"${name}"`));
    assert.equal(existsSync(join(import.meta.dirname, "../public/office/assets/kenney", `${name}.glb`)), true, name);
    assert.match(license, new RegExp(name.replace("-", "\\-")), name);
  }
  // Old stand-in models are gone from the files, the loader and the license.
  for (const name of ["bear", "tool-hammer", "ball-red"]) {
    assert.doesNotMatch(furnish, new RegExp(`"${name}"`));
    assert.equal(existsSync(join(import.meta.dirname, "../public/office/assets/kenney", `${name}.glb`)), false, name);
    assert.doesNotMatch(license, new RegExp(`${name}\\.glb`), name);
  }
  assert.doesNotMatch(client, /paper ?plane|紙飛機|letter/i);
  // The rack keeps six toys plus the bumper car; the popper, horn, frisbee and blower are gone everywhere.
  assert.doesNotMatch(client, /popper|horn|frisbee|blower|拉炮|喇叭|飛盤|吹龍/);
  const help = readFileSync(join(import.meta.dirname, "../public/index.html"), "utf8");
  assert.doesNotMatch(help, /拉炮|玩具喇叭|飛盤|吹龍/);
  assert.match(help, /嗶嗶槌、沙灘球、枕頭、泡泡槍、大水槍和魔法棒/);
  assert.match(help, /撞撞車/);
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
  const room = roomSource();
  const reset = room.slice(room.indexOf("protected onReset("), room.indexOf("protected onRise("));
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
  const client = clientSource();
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
  assert.equal(sql.exec(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0].value, "10");
  assert.equal(Number(sql.exec(`SELECT rot FROM furniture WHERE id = 'sofa-right'`).toArray()[0].rot), 270);
  assert.equal(Number(sql.exec(`SELECT rot FROM furniture WHERE id = 'sofa-left'`).toArray()[0].rot), 90);
  assert.equal(Number(sql.exec(`SELECT rot FROM furniture WHERE id = 'sofa-moved'`).toArray()[0].rot), 90);
  db.close();
});

test("the restroom is one room with two stalls, toilets and doors", () => {
  const office = content.buildOffice();
  const props = office.props;
  assert.deepEqual(office.zones.filter((item) => /restroom|^men$|^women$/.test(item.id)).map((item) => item.id), ["restroom"]);
  const zone = office.zones.find((item) => item.id === "restroom");
  assert.equal(zone.name, "廁所");
  const box = { x: zone.x * 32, y: zone.y * 32, w: zone.w * 32, h: zone.h * 32 };
  // The rooms next door keep their place and size.
  const keep = { gym: [13, 25, 7, 8], pantry: [21, 25, 8, 8], sofa: [30, 25, 9, 8], office: [1, 12, 38, 12] };
  for (const [id, want] of Object.entries(keep)) {
    const other = office.zones.find((item) => item.id === id);
    assert.deepEqual([other.x, other.y, other.w, other.h], want, id);
  }
  // No wall left inside the room, and exactly one two-tile doorway from the office.
  for (let ty = zone.y; ty < zone.y + zone.h; ty++) {
    for (let tx = zone.x; tx < zone.x + zone.w; tx++) assert.equal(office.walls[ty][tx], "0", `${tx},${ty}`);
  }
  const doorway = [];
  for (let tx = zone.x; tx < zone.x + zone.w; tx++) if (office.walls[zone.y - 1][tx] === "0") doorway.push(tx);
  assert.deepEqual(doorway, [6, 7]);
  const toilets = props.filter((item) => item.kind === "toilet");
  assert.equal(toilets.length, 2);
  assert.equal(props.filter((item) => item.kind === "urinal").length, 0);
  const parts = props.filter((item) => ["stallwall", "stalldoor", "toilet"].includes(item.kind));
  for (const part of parts) {
    assert.ok(part.x >= box.x && part.x + part.w <= box.x + box.w && part.y >= box.y && part.y + part.h <= box.y + box.h, part.id);
  }
  const doors = props.filter((item) => item.kind === "stalldoor").map((item) => item.id).sort();
  assert.deepEqual(doors, ["stall-a", "stall-b"]);
  assert.equal(props.filter((item) => item.kind === "stallwall").length, 3, "the middle partition is shared");
  const hall = office.zones.find((item) => item.id === "hall");
  const hallBox = { x: hall.x * 32, y: hall.y * 32, w: hall.w * 32, h: hall.h * 32 };
  for (const prop of parts) assert.equal(overlap(prop, hallBox), false, prop.id);
  const room = new stalls.StallDoors();
  assert.equal(room.toggle("stall-a", 0, 0).ok, false);
  assert.equal(room.toggle("nope", 96, 940).reason, "unknown");
  const door = props.find((item) => item.id === "stall-a");
  const opened = room.toggle("stall-a", door.x + door.w / 2, door.y - 30);
  assert.equal(opened.ok, true);
  assert.equal(opened.open, true);
  const closedCenter = { x: door.x + door.w / 2, y: door.y + door.h / 2 };
  // Just off the open leaf, which lies against the partition.
  const openCenter = { x: door.openX + door.openW + 8, y: door.openY + door.openH / 2 };
  // The door swings in along the stall's west partition, not out into the walkway.
  assert.ok(door.openY >= door.y + door.h && door.openX === door.x, JSON.stringify(door));
  assert.equal(room.blocks(closedCenter.x, closedCenter.y, 11), false);
  assert.equal(room.blocks(openCenter.x, openCenter.y, 11), true);
  const shut = room.toggle("stall-a", door.x + door.w / 2, door.y - 30);
  assert.equal(shut.open, false);
  assert.equal(room.blocks(closedCenter.x, closedCenter.y, 11), true);
  assert.equal(room.blocks(openCenter.x, openCenter.y, 11), false);
  assert.equal(stalls.STALL_COOLDOWN_MS, 300);
  const officeRoom = roomSource();
  assert.match(officeRoom, /STALL_COOLDOWN_MS/);
  assert.match(officeRoom, /this\.stalls\.load\(this\.meta\(STALL_META\)\)/);
  assert.match(officeRoom, /setMeta\(STALL_META, this\.stalls\.save\(\)\)/);
  const furnish = readFileSync(join(import.meta.dirname, "../public/office/furnish.js"), "utf8");
  for (const name of ["bath-toilet", "doorway", "wall"]) {
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
  assert.match(client, /bath-toilet/);
  assert.doesNotMatch(client, /urinal/);
  assert.match(license, /Bubbly Bathroom/);
  assert.match(client, new RegExp(`const REACH = ${stalls.STALL_REACH};`));
});

test("every body fits inside a stall with the door closed and can still reach its door", () => {
  const office = content.buildOffice();
  const radii = Object.values(content.BODY_RADIUS);
  for (const id of ["stall-a", "stall-b"]) {
    const door = office.props.find((item) => item.id === id);
    const toilet = office.props.find((item) => item.id === `${id}-toilet`);
    const walls = office.props.filter((item) => item.kind === "stallwall");
    const west = walls.find((item) => item.x + item.w === door.x);
    const east = walls.find((item) => item.x === door.x + door.w);
    assert.ok(west && east, id);
    const inside = { left: door.x, right: door.x + door.w, top: door.y + door.h, bottom: 32 * 33 };
    for (const r of radii) {
      // Stand in the middle, just behind the closed door: the whole body is inside the stall.
      const spot = { x: door.x + door.w / 2, y: Math.min(inside.top + r + 1, toilet.y - r - 1) };
      assert.ok(spot.y - r >= inside.top && spot.y + r <= toilet.y, `${id} r=${r} 跟馬桶和門之間放不下`);
      assert.ok(spot.x - r >= inside.left && spot.x + r <= inside.right, `${id} r=${r} 太窄`);
      const room = new stalls.StallDoors();
      assert.equal(room.blocks(spot.x, spot.y, r), false, `${id} r=${r} 被擋住`);
      // The door shuts behind them and opens again from inside.
      const body = { x: spot.x, y: spot.y, r };
      room.toggle(id, door.x + door.w / 2, door.y - 30);
      assert.equal(room.isOpen(id), true);
      assert.deepEqual(room.toggle(id, spot.x, spot.y, [body]), { ok: true, open: false }, `${id} r=${r} 關不上門`);
      assert.deepEqual(room.toggle(id, spot.x, spot.y, [body]), { ok: true, open: true }, `${id} r=${r} 從裡面打不開`);
      // Partly in the doorway, the door will not close on them.
      const inFrame = { x: spot.x, y: door.y + door.h / 2 + r - 4, r };
      assert.equal(room.toggle(id, spot.x, spot.y, [inFrame]).reason, "busy", `${id} r=${r}`);
    }
  }
  // Server and client both keep the whole body out of stall walls, doors and toilets.
  const officeRoom = roomSource();
  assert.match(officeRoom, /const fit = bodyRadiusOf\(att\.look\);\s*const stallRadius = this\.stalls\.blocks\(att\.x, att\.y, fit\) \? WALL_RADIUS : fit;/);
  assert.match(officeRoom, /this\.stalls\.blocks\(x, y, stallRadius\)/);
  assert.match(officeRoom, /bodies\.push\(\{ x: other\.x, y: other\.y, r: bodyRadiusOf\(other\.look\) \}\)/);
  const movement = readFileSync(join(import.meta.dirname, "../public/office/movement.js"), "utf8");
  assert.match(movement, /const STALL_KINDS = new Set\(\["stallwall", "stalldoor", "toilet"\]\);/);
  assert.match(movement, /const fit = stallFit\(beforeX, beforeY, radius\);/);
  const world = worldSource();
  assert.match(world, /const target = open\.get\(id\) \? -Math\.PI \/ 2 : 0;/);
});

test("walking into a coworker keeps clear of where they are now, not only where they are drawn", () => {
  const movement = readFileSync(join(import.meta.dirname, "../public/office/movement.js"), "utf8");
  const body = movement.slice(movement.indexOf("function bodyList()"), movement.indexOf("export function resolveBodies"));
  assert.match(body, /list\.push\(\{ id: person\.id, x: person\.x, y: person\.y, r \}\)/);
  assert.match(body, /const tx = person\.tx \?\? person\.x;/);
  assert.match(body, /list\.push\(\{ id: person\.id, x: tx, y: ty, r \}\)/);
});

test("stall doors refuse to swing onto someone standing in the frame", () => {
  const room = new stalls.StallDoors();
  const door = stalls.stallProps().find((item) => item.id === "stall-a");
  const knock = { x: door.x + door.w / 2, y: door.y - 30 };
  const inFrame = { x: door.x + door.w / 2, y: door.y + door.h / 2 };
  const inSwing = { x: door.openX + door.openW / 2, y: door.openY + door.openH / 2 };
  assert.deepEqual(room.toggle("stall-a", knock.x, knock.y, [knock, inSwing], 11), { ok: false, reason: "busy" });
  assert.equal(room.isOpen("stall-a"), false);
  assert.equal(room.toggle("stall-a", knock.x, knock.y, [knock, inFrame], 11).ok, true);
  assert.equal(room.isOpen("stall-a"), true);
  assert.deepEqual(room.toggle("stall-a", knock.x, knock.y, [knock, inFrame], 11), { ok: false, reason: "busy" });
  assert.equal(room.isOpen("stall-a"), true);
  assert.equal(room.blocks(inFrame.x, inFrame.y, 11), false);
  assert.equal(room.toggle("stall-a", knock.x, knock.y, [knock, { x: inFrame.x, y: inFrame.y - 60 }], 11).ok, true);
  assert.equal(room.isOpen("stall-a"), false);
  // Each stall keeps its own door.
  assert.equal(room.toggle("stall-b", stalls.stallProps().find((item) => item.id === "stall-b").x + 60, door.y - 30).ok, true);
  assert.equal(room.isOpen("stall-b"), true);
  assert.equal(room.isOpen("stall-a"), false);
});

test("stall doors survive a save and load round trip", () => {
  const room = new stalls.StallDoors();
  const door = stalls.stallProps().find((item) => item.id === "stall-b");
  room.toggle("stall-b", door.x + door.w / 2, door.y - 30);
  const saved = room.save();
  const back = new stalls.StallDoors();
  back.load(saved);
  assert.deepEqual(back.view(), room.view());
  assert.equal(back.isOpen("stall-b"), true);
  // Door ids from the old two-restroom layout are simply dropped.
  back.load(JSON.stringify(["stall-b", "men-a", "women-b", "nope", 3]));
  assert.deepEqual(back.view().filter((item) => item.open).map((item) => item.id), ["stall-b"]);
  for (const bad of [null, "", "{", "{}", "7"]) {
    back.load(bad);
    assert.equal(back.view().some((item) => item.open), false, String(bad));
  }
  assert.equal(typeof stalls.STALL_META, "string");
});

test("holding a snack at a stall door, E toggles the door instead of eating", () => {
  const game = clientSource();
  const bite = game.match(/const blockBite = ([^;]+);/);
  assert.ok(bite, "找不到 blockBite");
  assert.match(bite[1], /stalls\.nearest\(\)/);
});

test("the restroom has two sinks along the wall, each with a mirror above it", () => {
  const office = content.buildOffice();
  const sinks = office.props.filter((item) => item.kind === "sink");
  const mirrors = office.props.filter((item) => item.kind === "mirror");
  assert.equal(sinks.length, 2);
  assert.ok(sinks.every((item) => item.solid));
  assert.equal(mirrors.length, sinks.length);
  const zone = office.zones.find((item) => item.id === "restroom");
  const box = { x: zone.x * 32, y: zone.y * 32, w: zone.w * 32, h: zone.h * 32 };
  const parts = office.props.filter((item) => ["stallwall", "stalldoor", "toilet"].includes(item.kind));
  const doors = office.props.filter((item) => item.kind === "stalldoor");
  for (const sink of sinks) {
    assert.ok(sink.x >= box.x && sink.y >= box.y && sink.x + sink.w <= box.x + box.w && sink.y + sink.h <= box.y + box.h, sink.id);
    assert.ok(parts.every((part) => !overlap(sink, part)), `${sink.id} 擋到隔間`);
    // Standing at the mirror is out of reach of every stall door, so E there opens the mirror.
    const front = { x: sink.x + sink.w / 2, y: sink.y + sink.h + 12 };
    for (const door of doors) {
      const nx = Math.max(door.x, Math.min(front.x, door.x + door.w));
      const ny = Math.max(door.y, Math.min(front.y, door.y + door.h));
      assert.ok(Math.hypot(front.x - nx, front.y - ny) > stalls.STALL_REACH, `${sink.id} 太靠近 ${door.id}`);
    }
    const mirror = mirrors.find((item) => item.id === `${sink.id}-mirror`);
    assert.ok(mirror, sink.id);
    assert.equal(mirror.solid, false);
    assert.equal(mirror.x, sink.x);
    assert.ok(mirror.y <= sink.y, `${sink.id} 鏡子不在洗手台靠牆的那一側`);
    assert.ok(mirror.y + mirror.h <= sink.y + sink.h, `${sink.id} 鏡子超出洗手台`);
  }
  for (const other of sinks) {
    const hits = sinks.filter((item) => item !== other && overlap(item, other));
    assert.equal(hits.length, 0, other.id);
  }
  for (const [tx, ty] of [[6, 25], [7, 25]]) {
    const cx = tx * 32 + 16;
    const cy = ty * 32 + 16;
    assert.ok(sinks.every((sink) => cx < sink.x || cx > sink.x + sink.w || cy < sink.y || cy > sink.y + sink.h), `${tx},${ty}`);
  }
  const furnish = readFileSync(join(import.meta.dirname, "../public/office/furnish.js"), "utf8");
  const world = worldSource();
  for (const name of ["bath-sink", "bath-mirror"]) {
    assert.match(furnish, new RegExp(`"${name}"`));
    assert.match(world, new RegExp(`"${name}"`));
    assert.equal(existsSync(join(import.meta.dirname, "../public/office/assets/kenney", `${name}.glb`)), true, name);
  }
  // Help text, the mirror note and the server all say 廁所 now.
  const help = readFileSync(join(import.meta.dirname, "../public/index.html"), "utf8");
  assert.doesNotMatch(help + clientSource() + roomSource(), /男廁|女廁/);
});

test("gym and pantry decor uses real models that exist, fit their rooms and leave a walkway", () => {
  const office = content.buildOffice();
  const furnish = readFileSync(join(import.meta.dirname, "../public/office/furnish.js"), "utf8");
  const license = readFileSync(join(import.meta.dirname, "../public/office/assets/kenney/LICENSE.txt"), "utf8");
  const decor = office.props.filter((item) => item.kind === "decor");
  const gym = office.zones.find((item) => item.id === "gym");
  assert.equal(gym.name, "健身房");
  for (const item of decor) {
    assert.ok(item.model && item.tall > 0, JSON.stringify(item));
    assert.match(furnish, new RegExp(`"${item.model}"`), item.model);
    assert.equal(existsSync(join(import.meta.dirname, "../public/office/assets/kenney", `${item.model}.glb`)), true, item.model);
    assert.ok(license.includes(`${item.model}.glb`), `${item.model} 沒有寫進 LICENSE`);
  }
  const inGym = decor.filter((item) => item.x >= gym.x * 32 && item.x + item.w <= (gym.x + gym.w) * 32 && item.y >= gym.y * 32 && item.y + item.h <= (gym.y + gym.h) * 32);
  for (const model of ["gym-treadmill", "gym-bike", "gym-dumbbells", "gym-kettlebells", "gym-bench", "gym-mats", "gym-ball", "gym-cooler"]) {
    assert.ok(inGym.some((item) => item.model === model), model);
  }
  assert.equal(inGym.filter((item) => item.model === "gym-treadmill").length, 2);
  for (const model of ["kitchenSink", "kitchenCabinetUpper", "kitchenFridge", "kitchenMicrowave", "kitchen-toaster", "kitchen-kettle", "kitchen-mug", "kitchen-dishrack", "tableRound", "rugRectangle", "trashcan", "pottedPlant", "bookcaseOpenLow"]) {
    assert.ok(decor.some((item) => item.model === model), model);
  }
  // Every open floor tile in the new rooms is reachable from spawn (stall insides sit behind closed doors).
  const blocked = (tx, ty) => {
    if (office.walls[ty]?.[tx] !== "0") return true;
    const cx = tx * 32 + 16;
    const cy = ty * 32 + 16;
    return office.props.some((prop) => prop.solid && cx >= prop.x && cx <= prop.x + prop.w && cy >= prop.y && cy <= prop.y + prop.h);
  };
  const start = [Math.floor(office.spawn.x / 32), Math.floor(office.spawn.y / 32)];
  const seen = new Set([start.join(",")]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + dx},${y + dy}`;
      if (seen.has(key) || blocked(x + dx, y + dy)) continue;
      seen.add(key);
      queue.push([x + dx, y + dy]);
    }
  }
  for (const id of ["restroom", "gym", "pantry"]) {
    const zone = office.zones.find((item) => item.id === id);
    let open = 0;
    for (let ty = zone.y; ty < zone.y + zone.h; ty++) {
      for (let tx = zone.x; tx < zone.x + zone.w; tx++) {
        if (id === "restroom" && ty * 32 + 16 >= stalls.STALL_Y) continue;
        if (blocked(tx, ty)) continue;
        open += 1;
        assert.ok(seen.has(`${tx},${ty}`), `${id} ${tx},${ty} 走不到`);
      }
    }
    assert.ok(open >= 10, `${id} 空地太少`);
  }
});

test("the pantry coffee machine and water cooler move off the new counter only if never moved", async () => {
  const { db, sql } = officeDb();
  sql.transaction(() => migrations.ensureTables(sql));
  sql.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '8')`);
  sql.exec(`INSERT INTO furniture (id, kind, x, y, rot) VALUES ('coffee-1', 'coffee', 712, 932, 0)`);
  sql.exec(`INSERT INTO furniture (id, kind, x, y, rot) VALUES ('water-1', 'water', 300, 400, 0)`);
  await migrations.runMigrations(sql, [], async (token) => token);
  assert.equal(sql.exec(`SELECT value FROM meta WHERE key = 'schema_version'`).toArray()[0].value, "10");
  const coffee = sql.exec(`SELECT x, y FROM furniture WHERE id = 'coffee-1'`).toArray()[0];
  const water = sql.exec(`SELECT x, y FROM furniture WHERE id = 'water-1'`).toArray()[0];
  const office = content.buildOffice();
  const fresh = office.furniture.find((item) => item.id === "coffee-1");
  assert.deepEqual([Number(coffee.x), Number(coffee.y)], [fresh.x, fresh.y]);
  assert.deepEqual([Number(water.x), Number(water.y)], [300, 400]);
  for (const id of ["coffee-1", "water-1"]) {
    const item = office.furniture.find((entry) => entry.id === id);
    const size = content.furnitureSize(item.kind, item.rot);
    const box = { x: item.x, y: item.y, w: size.w, h: size.h };
    assert.ok(office.props.every((prop) => !prop.solid || !overlap(box, prop)), `${id} 壓到茶水間擺設`);
  }
  db.close();
});

test("snack cabinet keeps its body and the drinks machine can use the Kenney vending model", () => {
  const furnish = readFileSync(join(import.meta.dirname, "../public/office/furnish.js"), "utf8");
  const world = worldSource();
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

test("the version label uses the deploy commit, then git, then just the version", async () => {
  const { versionLabel } = await import("../scripts/version.mjs");
  assert.equal(versionLabel("0.5.0", { WORKERS_CI_COMMIT_SHA: "A1B2C3D4E5F6" }, () => "ffffff0"), "v0.5.0 · a1b2c3d");
  assert.equal(versionLabel("0.5.0", {}, () => "1234567\n"), "v0.5.0 · 1234567");
  assert.equal(versionLabel("0.5.0", {}, () => ""), "v0.5.0");
  assert.equal(versionLabel("0.5.0", { WORKERS_CI_COMMIT_SHA: "not a sha" }, () => ""), "v0.5.0");
  assert.equal(versionLabel(undefined, {}, () => ""), "dev");
});

async function signTelegram(fields, token) {
  const { createHash, createHmac } = await import("node:crypto");
  const check = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join("\n");
  const secret = createHash("sha256").update(token).digest();
  return { ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") };
}

test("Telegram 登入只接受簽章正確且沒過期的資料", async () => {
  const token = "123456:test-bot-token";
  const now = 1_800_000_000_000;
  const fields = { id: 424242, first_name: "小八", last_name: "貓", username: "hachi", auth_date: Math.floor(now / 1000) - 60 };
  const valid = await signTelegram(fields, token);
  assert.deepEqual(await telegram.checkTelegramAuth(valid, token, now), { telegramId: "424242", name: "小八 貓" });
  assert.equal(await telegram.checkTelegramAuth({ ...valid, id: 424243 }, token, now), null);
  assert.equal(await telegram.checkTelegramAuth({ ...valid, hash: valid.hash.replace(/^./, (c) => (c === "a" ? "b" : "a")) }, token, now), null);
  assert.equal(await telegram.checkTelegramAuth(valid, "999:other-token", now), null);
  assert.equal(await telegram.checkTelegramAuth({ ...valid, extra: { x: 1 } }, token, now), null);
  const stale = await signTelegram({ ...fields, auth_date: Math.floor(now / 1000) - 2 * 24 * 60 * 60 }, token);
  assert.equal(await telegram.checkTelegramAuth(stale, token, now), null);
  const future = await signTelegram({ ...fields, auth_date: Math.floor(now / 1000) + 3600 }, token);
  assert.equal(await telegram.checkTelegramAuth(future, token, now), null);
  assert.equal(await telegram.checkTelegramAuth(valid, "", now), null);
  assert.equal(telegram.telegramBot({}), null);
  assert.equal(telegram.telegramBot({ TELEGRAM_BOT_TOKEN: token }), null);
  assert.deepEqual(telegram.telegramBot({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_BOT_USERNAME: "@office_bot" }), { token, username: "office_bot" });
});

test("訪客不能調整設備、改名，也拿不到成員或 Telegram 的 ID", () => {
  assert.equal(guests.guestBlocks("edit", { on: true }, "訪客123"), "訪客不能調整設備");
  assert.equal(guests.guestBlocks("edit", { on: false }, "訪客123"), null);
  assert.equal(guests.guestBlocks("furn", { op: "move" }, "訪客123"), "訪客不能調整設備");
  assert.equal(guests.guestBlocks("profile", { displayName: "naco" }, "訪客123"), "訪客不能改名稱");
  assert.equal(guests.guestBlocks("profile", { displayName: "訪客123", animal: "cat" }, "訪客123"), null);
  assert.equal(guests.guestBlocks("move", { x: 1, y: 2 }, "訪客123"), null);
  assert.equal(guests.guestBlocks("chat", { text: "hi" }, "訪客123"), null);
  assert.equal(guests.reservedLoginId("guest-abcd"), true);
  assert.equal(guests.reservedLoginId("tg-1234"), true);
  assert.equal(guests.reservedLoginId("naco"), false);
  let i = 0;
  const steps = [0, 0, 0.5];
  const name = guests.guestName(new Set(["訪客100"]), () => steps[i++]);
  assert.equal(name, "訪客550");
});

test("閒置的訪客會被清掉，在線的訪客和成員不會", async () => {
  const { sql } = officeDb();
  await migrations.runMigrations(sql, [], async (token) => token);
  const now = 10_000_000;
  for (const id of ["guest-old", "guest-live", "guest-new", "naco"]) {
    sql.exec(
      `INSERT INTO members (id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at) VALUES (?, ?, 'cat', '{}', 0, 0, 1, 0)`,
      id,
      id,
    );
    sql.exec(`INSERT INTO member_sessions (token_hash, member_id, device_key, epoch, created_at) VALUES (?, ?, ?, 1, 0)`, `h-${id}`, id, `d-${id}`);
  }
  for (const [id, seen] of [["guest-old", 0], ["guest-live", 0], ["guest-new", now - 1000]]) {
    sql.exec(`INSERT INTO guests (member_id, created_at, last_seen) VALUES (?, ?, ?)`, id, seen, seen);
  }
  assert.equal(guests.guestCount(sql), 3);
  assert.equal(guests.isGuest(sql, "naco"), false);
  assert.deepEqual(guests.sweepGuests(sql, (id) => id === "guest-live", now), ["guest-old"]);
  const left = sql.exec(`SELECT id FROM members ORDER BY id`).toArray().map((row) => row.id);
  assert.deepEqual(left, ["guest-live", "guest-new", "naco"]);
  assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM member_sessions WHERE member_id = 'guest-old'`).toArray()[0].n, 0);
  assert.equal(guests.guestCount(sql), 2);
});

// Runs the real office room on an in-memory database to check who needs the office password.
async function memoryRoom() {
  const roomFile = join(outdir, "office-room.mjs");
  await esbuild.build({
    entryPoints: [join(import.meta.dirname, "../src/office-room.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: roomFile,
  });
  globalThis.WebSocketRequestResponsePair ??= class {};
  const { OfficeRoom } = await import(pathToFileURL(roomFile).href);
  const { db, sql } = officeDb();
  let boot;
  const ctx = {
    storage: { sql, transactionSync: (run) => sql.transaction(run) },
    setWebSocketAutoResponse() {},
    blockConcurrencyWhile(run) {
      boot = run();
    },
    getWebSockets: () => [],
  };
  const room = new OfficeRoom(ctx, {});
  await boot;
  const call = async (path, body, headers = {}) => {
    const response = await room.fetch(
      new Request(`https://office.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-office-ip": "10.0.0.1", ...headers },
        body: JSON.stringify(body),
      }),
    );
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    return { status: response.status, cookie, ...(await response.json()) };
  };
  const me = async (cookie) => (await room.fetch(new Request("https://office.test/api/office/me", { headers: { cookie } }))).status;
  assert.equal((await call("/api/office/admin/password", { password: "office-pass" }, { "x-office-admin": "1" })).status, 200);
  return { db, sql, call, me };
}

test("訪客和第一次用 Telegram 登入都要辦公室密碼，已連結的 Telegram 不用", async () => {
  const { db, sql, call } = await memoryRoom();
  const failures = () => Number(sql.exec(`SELECT COUNT(*) AS n FROM auth_failures WHERE kind = 'login'`).one().n);
  assert.equal((await call("/api/office/guest", {})).status, 401);
  assert.equal((await call("/api/office/guest", { password: "wrong-pass" })).status, 401);
  assert.equal(guests.guestCount(sql), 0);
  assert.equal(failures(), 2);
  const guest = await call("/api/office/guest", { password: "office-pass" });
  assert.equal(guest.status, 200);
  assert.ok(guest.profile.id.startsWith("guest-"));
  assert.equal(failures(), 0);

  const marker = { [telegram.TELEGRAM_MARKER]: "1" };
  const tg = { telegramId: "424242", name: "小八", deviceKey: "cd".repeat(20) };
  assert.equal((await call("/api/office/telegram/enter", { ...tg, password: "office-pass" })).status, 401, "沒有 Worker 標記不能進");
  const ask = await call("/api/office/telegram/enter", tg, marker);
  assert.equal(ask.status, 401);
  assert.equal(ask.needsPassword, true);
  assert.equal((await call("/api/office/telegram/enter", { ...tg, password: "wrong-pass" }, marker)).status, 401);
  assert.equal(failures(), 1);
  assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM telegram_members`).one().n, 0);
  const first = await call("/api/office/telegram/enter", { ...tg, password: "office-pass" }, marker);
  assert.equal(first.status, 200);
  assert.ok(first.profile.id.startsWith("tg-"));
  const again = await call("/api/office/telegram/enter", { ...tg, deviceKey: "ef".repeat(20) }, marker);
  assert.equal(again.status, 200);
  assert.equal(again.profile.id, first.profile.id);

  // Wrong guesses on any of these paths share the password login limit.
  for (let i = 0; i < pairing.AUTH_LIMIT; i++) await call("/api/office/guest", { password: "wrong-pass" });
  assert.equal((await call("/api/office/guest", { password: "office-pass" })).status, 429);
  assert.equal((await call("/api/office/login", { password: "office-pass" })).status, 429);
  assert.equal((await call("/api/office/telegram/enter", { ...tg, telegramId: "555", password: "office-pass" }, marker)).status, 429);
  db.close();
});

test("訪客清掉時分數一起清；備份還原保留訪客與 Telegram 對應", async () => {
  const { sql } = officeDb();
  await migrations.runMigrations(sql, [], async (token) => token);
  for (const id of ["guest-aa", "tg-bb"]) {
    sql.exec(`INSERT INTO members (id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at) VALUES (?, ?, 'cat', '{}', 0, 0, 1, 0)`, id, id);
    sql.exec(`INSERT INTO scores (member_id, game, score, updated_at) VALUES (?, 'zip', 5, 1)`, id);
  }
  sql.exec(`INSERT INTO guests (member_id, created_at, last_seen) VALUES ('guest-aa', 1, 2)`);
  sql.exec(`INSERT INTO telegram_members (telegram_id, member_id, created_at) VALUES ('424242', 'tg-bb', 3)`);
  const backup = JSON.parse(JSON.stringify(migrations.exportOffice(sql)));
  assert.deepEqual(backup.guests, [{ member_id: "guest-aa", created_at: 1, last_seen: 2 }]);
  assert.deepEqual(backup.telegram, [{ telegram_id: "424242", member_id: "tg-bb", created_at: 3 }]);
  assert.deepEqual(guests.sweepGuests(sql, () => false, 10_000_000), ["guest-aa"]);
  assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM scores WHERE member_id = 'guest-aa'`).one().n, 0);
  assert.equal(migrations.restoreOffice(sql, backup).ok, true);
  assert.equal(guests.isGuest(sql, "guest-aa"), true);
  assert.equal(sql.exec(`SELECT member_id FROM telegram_members WHERE telegram_id = '424242'`).one().member_id, "tg-bb");
  const { guests: _g, telegram: _t, ...older } = backup;
  assert.equal(migrations.restoreOffice(sql, older).ok, true, "舊備份沒有這兩份清單也能還原");
  assert.equal(guests.guestCount(sql), 0);
  assert.equal(migrations.restoreOffice(sql, { ...backup, telegram: [{ telegram_id: "1", member_id: "nobody" }] }).ok, false);
  assert.equal(migrations.restoreOffice(sql, { ...backup, guests: [{ member_id: "nobody" }] }).ok, false);
});

test("訪客改用新的 Telegram 帳號時，原地變成成員並保留名稱、造型、位置和分數", async () => {
  const { db, sql, call, me } = await memoryRoom();
  const marker = { [telegram.TELEGRAM_MARKER]: "1" };
  const guest = await call("/api/office/guest", { password: "office-pass" });
  const gid = guest.profile.id;
  sql.exec(`UPDATE members SET pos_x = 321, pos_y = 654 WHERE id = ?`, gid);
  sql.exec(`INSERT INTO scores (member_id, game, score, updated_at) VALUES (?, 'zip', 7, 1)`, gid);
  const up = { telegramId: "777", name: "小八", deviceKey: "ab".repeat(20) };
  const asGuest = { ...marker, cookie: guest.cookie };
  assert.equal((await call("/api/office/telegram/upgrade", { ...up, password: "office-pass" }, { cookie: guest.cookie })).status, 401, "沒有 Worker 標記不能升級");
  const ask = await call("/api/office/telegram/upgrade", up, asGuest);
  assert.equal(ask.needsPassword, true);
  assert.equal((await call("/api/office/telegram/upgrade", { ...up, password: "wrong-pass" }, asGuest)).status, 401);
  assert.equal(Number(sql.exec(`SELECT COUNT(*) AS n FROM auth_failures WHERE kind = 'login'`).one().n), 1);
  assert.equal(guests.guestCount(sql), 1, "密碼錯時訪客還在");
  assert.equal((await call("/api/office/telegram/upgrade", { ...up, password: "office-pass" }, marker)).status, 401, "沒有訪客登入不能升級");

  const done = await call("/api/office/telegram/upgrade", { ...up, password: "office-pass" }, asGuest);
  assert.equal(done.status, 200);
  assert.ok(done.profile.id.startsWith("tg-"));
  assert.equal(done.profile.displayName, guest.profile.displayName);
  assert.deepEqual(done.profile.look, guest.profile.look);
  assert.equal(guests.guestCount(sql), 0, "訪客名額馬上空出來");
  assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM members WHERE id = ?`, gid).one().n, 0);
  assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM member_sessions WHERE member_id = ?`, gid).one().n, 0);
  const row = sql.exec(`SELECT pos_x, pos_y FROM members WHERE id = ?`, done.profile.id).one();
  assert.deepEqual([Number(row.pos_x), Number(row.pos_y)], [321, 654]);
  assert.equal(sql.exec(`SELECT score FROM scores WHERE member_id = ? AND game = 'zip'`, done.profile.id).one().score, 7);
  assert.equal(sql.exec(`SELECT member_id FROM telegram_members WHERE telegram_id = '777'`).one().member_id, done.profile.id);
  assert.equal(await me(guest.cookie), 401, "舊的訪客登入失效");
  assert.equal(await me(done.cookie), 200);
  assert.equal((await call("/api/office/telegram/upgrade", { ...up, password: "office-pass" }, { ...marker, cookie: done.cookie })).status, 403, "成員不能再升級");
  db.close();
});

test("訪客改用已有成員的 Telegram 時，沿用成員資料並把分數取最高合併", async () => {
  const { db, sql, call, me } = await memoryRoom();
  const marker = { [telegram.TELEGRAM_MARKER]: "1" };
  const member = await call("/api/office/telegram/enter", { telegramId: "888", name: "吉伊", deviceKey: "cd".repeat(20), password: "office-pass" }, marker);
  const mid = member.profile.id;
  for (const [game, score] of [["zip", 10], ["dash", 3]]) sql.exec(`INSERT INTO scores (member_id, game, score, updated_at) VALUES (?, ?, ?, 1)`, mid, game, score);
  const guest = await call("/api/office/guest", { password: "office-pass" });
  const gid = guest.profile.id;
  for (const [game, score] of [["zip", 7], ["dash", 9], ["jump", 4]]) sql.exec(`INSERT INTO scores (member_id, game, score, updated_at) VALUES (?, ?, ?, 2)`, gid, game, score);
  const done = await call("/api/office/telegram/upgrade", { telegramId: "888", name: "別的名字", deviceKey: "ef".repeat(20), password: "office-pass" }, { ...marker, cookie: guest.cookie });
  assert.equal(done.status, 200);
  assert.equal(done.profile.id, mid);
  assert.equal(done.profile.displayName, "吉伊");
  assert.deepEqual(done.profile.look, member.profile.look);
  const scores = sql.exec(`SELECT game, score FROM scores WHERE member_id = ? ORDER BY game`, mid).toArray().map((r) => [r.game, Number(r.score)]);
  assert.deepEqual(scores, [["dash", 9], ["jump", 4], ["zip", 10]]);
  for (const table of ["scores", "member_sessions", "member_devices"]) {
    assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM ${table} WHERE member_id = ?`, gid).one().n, 0, table);
  }
  assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM members WHERE id = ?`, gid).one().n, 0);
  assert.equal(guests.guestCount(sql), 0);
  assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM telegram_members`).one().n, 1);
  assert.equal(await me(guest.cookie), 401);
  assert.equal(await me(done.cookie), 200);
  assert.equal(await me(member.cookie), 200, "成員原本的裝置不受影響");
  db.close();
});

test("desk monitors light up for whoever sits at that desk and go dark when they stand", async () => {
  const monitorFile = join(outdir, "monitors.mjs");
  await esbuild.build({
    entryPoints: [join(import.meta.dirname, "../public/office/monitors.js")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: monitorFile,
  });
  const monitors = await import(pathToFileURL(monitorFile).href);
  const office = content.buildOffice();
  const specs = new Map(content.palette().map((item) => [item.kind, item]));
  const furniture = office.furniture.map((item) => ({ ...item, seat: null }));
  const here = new Set(["momo", "naco"]);
  const present = (id) => here.has(id);
  const chair = (id) => furniture.find((item) => item.id === id);
  assert.deepEqual([...monitors.litMonitors(furniture, present, specs)], []);
  chair("desk-3-chair").seat = "momo";
  assert.deepEqual([...monitors.litMonitors(furniture, present, specs)], ["desk-3-monitor"]);
  chair("desk-7-chair").seat = "naco";
  assert.deepEqual([...monitors.litMonitors(furniture, present, specs)].sort(), ["desk-3-monitor", "desk-7-monitor"]);
  // A meeting room chair is nowhere near a desk.
  chair("meet-chair-w").seat = "naco";
  assert.deepEqual([...monitors.litMonitors(furniture, present, specs)].sort(), ["desk-3-monitor", "desk-7-monitor"]);
  // Standing up turns the screen off; someone who already left does not keep it on.
  chair("desk-3-chair").seat = null;
  here.delete("naco");
  assert.deepEqual([...monitors.litMonitors(furniture, present, specs)], []);
  // Every desk chair at home lights its own desk's monitor and no other.
  here.add("naco");
  for (const item of furniture) item.seat = null;
  for (let desk = 1; desk <= 10; desk++) {
    chair(`desk-${desk}-chair`).seat = "naco";
    assert.deepEqual([...monitors.litMonitors(furniture, present, specs)], [`desk-${desk}-monitor`]);
    chair(`desk-${desk}-chair`).seat = null;
  }
});

test("monitor screens switch on the model's own glass, with no extra sheet stuck on top", () => {
  const props = readFileSync(join(import.meta.dirname, "../public/office/world-props.js"), "utf8");
  const start = props.indexOf('if (kind === "monitor") {');
  const block = props.slice(start, props.indexOf("return true;", start));
  assert.match(block, /markScreen\(model\)/);
  assert.doesNotMatch(block, /glowPlane/);
  const source = readFileSync(join(import.meta.dirname, "../public/office/monitors.js"), "utf8");
  // A feature file only declares things; nothing runs when it is loaded.
  for (const line of source.split("\n")) {
    if (!line || /^\s/.test(line) || line.startsWith("//") || line.startsWith("/**") || line === "}") continue;
    assert.match(line, /^(export )?(function|const) /, line);
  }
  assert.match(clientSource(), /attachMonitors\(\{ state, world \}\)/);
  assert.match(worldSource(), /setMonitorHook/);
});

test("meeting room keeps a small whiteboard, the big screen, hands and one vote at a time", async () => {
  const serverFile = join(outdir, "meeting-server.mjs");
  await esbuild.build({ entryPoints: [join(import.meta.dirname, "../src/meeting.ts")], bundle: true, format: "esm", platform: "neutral", outfile: serverFile });
  const server = await import(pathToFileURL(serverFile).href);
  const room = new server.MeetingRoom();
  room.load(null);
  // Strokes are clamped to the board and kept short; bad ones are refused.
  const stroke = room.draw("a", [[-20, 5.4], [400, 900], [10, 10]], 1);
  assert.deepEqual(stroke.points, [[0, 5], [server.BOARD_W, server.BOARD_H], [10, 10]]);
  assert.equal(room.draw("a", [[1, 1]], 9), null);
  assert.equal(room.draw("a", Array.from({ length: server.BOARD_POINTS + 1 }, () => [1, 1]), 0), null);
  assert.equal(room.draw("a", [[1, "x"]], 0), null);
  for (let i = 0; i < server.BOARD_STROKES + 5; i++) room.draw("a", [[i % 300, 1]], 0);
  assert.equal(room.strokes.length, server.BOARD_STROKES);
  // Notes are cleaned, cut short and capped.
  assert.equal(room.note("a", "  \u202E<b>布丁</b>\u0007  ").text, "<b>布丁</b>");
  assert.equal(room.note("a", "   "), null);
  assert.equal([...room.note("a", "長".repeat(80)).text].length, server.NOTE_CHARS);
  for (let i = 0; i < 12; i++) room.note("b", `n${i}`);
  assert.equal(room.notes.length, server.BOARD_NOTES);
  assert.equal(room.notes.at(-1).text, "n11");
  // The screen: presets, a short title, on and off.
  assert.equal(room.project("a", { slide: "goal" }), null);
  assert.deepEqual({ on: room.projector.on, slide: room.projector.slide }, { on: true, slide: "goal" });
  assert.equal(room.project("a", { slide: "nope" }), "沒有這張投影片");
  assert.equal(room.project("a", { title: "布丁".repeat(40) }), null);
  assert.equal([...room.projector.title].length, server.TITLE_CHARS);
  assert.equal(room.projector.slide, "");
  assert.equal(room.project("a", { title: "   " }), "請輸入要投影的文字");
  assert.equal(room.project("b", { on: false }), null);
  assert.equal(room.projector.on, false);
  assert.ok(room.projector.title, "turning the screen off keeps what it showed");
  // Hands go up and down once.
  assert.equal(room.raise("a", true), true);
  assert.equal(room.raise("a", true), false);
  assert.deepEqual(room.view((id) => id !== "a").hands, []);
  assert.deepEqual(room.view().hands, ["a"]);
  // One vote at a time, with 2 to 4 distinct options.
  assert.match(room.startVote("a", "午餐？", ["拉麵"]), /選項/);
  assert.match(room.startVote("a", "午餐？", ["拉麵", "拉麵"]), /選項/);
  assert.match(room.startVote("a", "  ", ["拉麵", "咖哩"]), /問題/);
  assert.match(room.startVote("a", "午餐？", ["1", "2", "3", "4", "5"]), /選項/);
  assert.equal(room.startVote("a", "午餐？", ["拉麵", "咖哩", ""]), null);
  assert.deepEqual(room.vote.options, ["拉麵", "咖哩"]);
  assert.equal(room.startVote("b", "再一題", ["好", "不好"]), "已經有投票在進行");
  assert.equal(room.cast("b", 1), null);
  assert.equal(room.cast("c", 0), null);
  assert.equal(room.cast("c", 1), null, "changing your mind replaces your vote");
  assert.equal(room.cast("c", 5), "沒有這個選項");
  assert.deepEqual(room.voteView().counts, [0, 2]);
  assert.equal(room.endVote("b", true), "只有發起人可以結束投票");
  assert.equal(room.endVote("b", false), null, "anyone can close it once the asker has left the room");
  assert.equal(room.cast("b", 0), "現在沒有投票");
  assert.equal(room.startVote("b", "再一題", ["好", "不好"]), null);
  // Saved state comes back; raised hands are live only.
  const copy = new server.MeetingRoom();
  copy.load(room.save());
  assert.equal(copy.strokes.length, room.strokes.length);
  assert.deepEqual(copy.notes, room.notes);
  assert.deepEqual(copy.projector, room.projector);
  assert.deepEqual(copy.voteView(), room.voteView());
  assert.equal(copy.hands.size, 0);
  copy.load("{not json");
  assert.equal(copy.strokes.length, 0);
  copy.load(JSON.stringify({ strokes: [{ ink: 7, points: [[1, 1]], by: "a" }], notes: [{ text: 5, by: "a" }], projector: { on: true, slide: "x", title: "" }, vote: { question: "q", options: ["a"], by: "a" } }));
  assert.deepEqual([copy.strokes.length, copy.notes.length, copy.projector.slide, copy.vote], [0, 0, "", null]);
  assert.equal(room.clearBoard(), true);
  assert.equal(room.clearBoard(), false);
  assert.deepEqual(room.view().board, { strokes: [], notes: [] });
  // The meeting zone matches the room on the map.
  const office = content.buildOffice();
  assert.equal(server.inMeeting(17 * 32, 3 * 32, office.zones), true);
  assert.equal(server.inMeeting(656, 336, office.zones), false);
  const screen = office.props.find((prop) => prop.kind === "screen");
  assert.ok(screen && screen.solid && server.inMeeting(screen.x + screen.w / 2, screen.y + screen.h / 2, office.zones), "the big screen stands inside the meeting room");

  const clientFile = join(outdir, "meeting-client.mjs");
  await esbuild.build({ entryPoints: [join(import.meta.dirname, "../public/office/meeting.js")], bundle: true, format: "esm", platform: "neutral", outfile: clientFile });
  const client = await import(pathToFileURL(clientFile).href);
  // Client and server agree on the board and its limits.
  for (const key of ["BOARD_W", "BOARD_H", "BOARD_POINTS", "NOTE_CHARS", "TITLE_CHARS", "QUESTION_CHARS", "OPTION_CHARS", "OPTIONS_MAX", "INKS"]) {
    assert.deepEqual(client[key], server[key], key);
  }
  assert.deepEqual(client.SLIDES.map((slide) => slide.id), server.SLIDES.map((slide) => slide.id));
  assert.equal(client.inMeetingRoom(office, 17 * 32, 3 * 32), true);
  assert.equal(client.inMeetingRoom(office, 656, 336), false);
  assert.deepEqual(client.thinStroke([[0, 0], [1, 1], [3, 0], [3.4, 0.2], [10, 10]]), [[0, 0], [3, 0], [10, 10]]);
  const long = Array.from({ length: 150 }, (_, i) => [i, i % 9]);
  const parts = client.splitStroke(long);
  assert.ok(parts.every((part) => part.length <= server.BOARD_POINTS && part.length >= 2));
  assert.deepEqual(parts[0].at(-1), parts[1][0], "pieces of a long stroke join up");
  assert.equal(parts.reduce((sum, part) => sum + part.length, 0) - (parts.length - 1), long.length);
  assert.deepEqual(client.voteTally({ options: ["a", "b", "c"], counts: [2, 2, 1] }), { total: 5, top: ["a", "b"] });
  assert.deepEqual(client.voteTally({ options: ["a", "b"], counts: [0, 0] }), { total: 0, top: [] });
});

test("meeting tools are wired in: room chat stays in the room and hands drop on the way out", () => {
  const room = roomSource();
  assert.match(room, /class OfficeRoom extends RoomPantry/);
  assert.match(room, /class RoomPantry extends RoomMeeting/);
  assert.match(room, /class RoomMeeting extends RoomFurniture/);
  assert.match(room, /kind === "meeting"\) this\.onMeeting/);
  assert.match(room, /if \(this\.roomChat\(att, text, now\)\) return;/);
  assert.match(room, /this\.settleHand\(att, true\)/);
  assert.match(room, /meeting: this\.meetingView\(\)/);
  assert.match(room, /if \(!this\.inMeetingRoom\(att\)\) return this\.meetingError/);
  // Whispers inside the meeting room stay whispers.
  const chat = room.slice(room.indexOf("protected onChat("));
  assert.ok(chat.indexOf("att.whisper || body.whisper") < chat.indexOf("this.roomChat("));
  const client = clientSource();
  assert.match(client, /meeting\.onNet\(message\)/);
  assert.match(client, /attachMeeting\(/);
  assert.match(worldSource(), /setMeetingHook/);
  assert.match(worldSource(), /prop\.kind === "screen"/);
  // The meeting room gets no new storage table: everything sits in the meta row.
  assert.ok(!/meeting/i.test(readFileSync(join(import.meta.dirname, "../src/migrations.ts"), "utf8")));
});

test("pantry stools are fixed seats around the table, and no seats appear in the gym or game room", () => {
  const office = content.buildOffice();
  const zone = (id) => office.zones.find((item) => item.id === id);
  const inside = (item, z) => item.x >= z.x * 32 && item.y >= z.y * 32 && item.x < (z.x + z.w) * 32 && item.y < (z.y + z.h) * 32;
  const stools = office.furniture.filter((item) => item.kind === "stool");
  assert.deepEqual(stools.map((item) => item.id).sort(), ["pantry-stool-e", "pantry-stool-n", "pantry-stool-s", "pantry-stool-w"]);
  for (const stool of stools) {
    assert.ok(inside(stool, zone("pantry")), stool.id);
    assert.equal(content.furnitureFits(office.walls, "stool", stool.x, stool.y, stool.rot), true);
  }
  assert.equal(content.FURNITURE.stool.fixed, true);
  assert.equal(content.isSeatKind("stool"), true);
  assert.equal(content.isSeatKind("chair"), true);
  assert.equal(content.isSeatKind("sofa"), false);
  // The stools used to be scenery; now they are only furniture, so nobody sits on a picture of a stool.
  assert.equal(office.props.some((item) => item.model === "stoolBar"), false);
  for (const id of ["gym", "game"]) {
    assert.equal(office.furniture.some((item) => content.isSeatKind(item.kind) && inside(item, zone(id))), false, id);
  }
  const furnish = readFileSync(join(import.meta.dirname, "../public/office/furnish.js"), "utf8");
  const license = readFileSync(join(import.meta.dirname, "../public/office/assets/kenney/LICENSE.txt"), "utf8");
  assert.match(furnish, /"stoolBar"/);
  assert.ok(license.includes("stoolBar.glb"));
  const room = roomSource();
  assert.match(room, /chair\.kind !== "chair"\) return;/);
  assert.match(room, /if \(!isSeatKind\(row\.kind\)\) continue;/);
  // Stepping off a stool never lands inside the table or the counter.
  assert.match(room, /const solids = chair\.kind === "chair" \? null : this\.solidFurniture\(\);/);
  assert.match(room, /!this\.inWall\(x, y\) && !blocked\(x, y\)/);
  const client = clientSource();
  assert.match(client, /if \(item\.kind === "stool"\) \{\n    state\.ride = \{ vx: 0, vy: 0 \};\n    return;/);
});

test("pantry keeps a few fridge notes, one microwave and hot treats that are never out of stock", async () => {
  const serverFile = join(outdir, "pantry-server.mjs");
  await esbuild.build({ entryPoints: [join(import.meta.dirname, "../src/pantry.ts")], bundle: true, format: "esm", platform: "neutral", outfile: serverFile });
  const pantry = await import(pathToFileURL(serverFile).href);
  const room = new pantry.PantryRoom();
  room.load(null);
  assert.equal(room.stick("a", "   ", 0), null);
  const first = room.stick("a", "記得買牛奶".repeat(9), 9);
  assert.equal([...first.text].length, pantry.FRIDGE_CHARS);
  assert.equal(first.tint, 0);
  for (let i = 0; i < pantry.FRIDGE_NOTES + 2; i++) room.stick("b", `便利貼 ${i}`, 2);
  assert.equal(room.notes.length, pantry.FRIDGE_NOTES);
  assert.equal(room.notes.some((note) => note.id === first.id), false);
  const last = room.notes.at(-1);
  assert.equal(room.peel(last.id), true);
  assert.equal(room.peel(last.id), false);
  // Saved notes come back trimmed and checked, and new ids never repeat an old one.
  const again = new pantry.PantryRoom();
  again.load(JSON.stringify({ ...JSON.parse(room.save()), notes: [{ id: "x", text: "", by: "c" }, ...room.notes] }));
  assert.deepEqual(again.notes, room.notes);
  const fresh = again.stick("c", "新的", 1);
  assert.equal(again.notes.filter((note) => note.id === fresh.id).length, 1);
  again.load("{bad");
  assert.deepEqual(again.notes, []);
  // The microwave: one bun at a time, ready only after the wait, and it frees up if nobody comes back.
  assert.equal(room.heat("a", 1000), null);
  assert.match(room.heat("b", 1100), /有人在用/);
  assert.match(room.heat("a", 1100), /你的包子/);
  assert.match(room.unload("a", 1000 + pantry.HEAT_MS - 1), /還沒好/);
  assert.match(room.unload("b", 1000 + pantry.HEAT_MS), /沒有你的/);
  assert.equal(room.ovenView(1000).left, pantry.HEAT_MS);
  assert.equal(room.unload("a", 1000 + pantry.HEAT_MS), null);
  assert.equal(room.ovenView(5000), null);
  assert.equal(room.heat("b", 9000), null);
  assert.equal(room.heat("a", 9000 + pantry.HEAT_MS + pantry.OVEN_KEEP_MS), null);
  assert.equal(room.forget("b"), false);
  assert.equal(room.forget("a"), true);
  assert.equal(room.oven, null);
  assert.ok(!/oven|heat/i.test(room.save()));
  // Hot treats go straight into hands; the cabinet and vending machine counts never include them.
  const snack = new snacks.SnackRoom();
  for (const id of pantry.HOT_DRINKS) assert.equal(snacks.snackItem(id).hot, true);
  assert.equal(snacks.snackItem(pantry.OVEN_ITEM).hot, true);
  assert.equal("hotcoffee" in snack.view(), false);
  assert.equal(snack.take("a", "hotcoffee", 0, 0, () => ({ x: 0, y: 0 }), 0).reason, "unknown");
  assert.equal(snack.give("a", "cookie"), false);
  assert.equal(snack.give("a", "cocoa"), true);
  assert.equal(snack.hand("a"), "cocoa");
  assert.equal(snack.pass("a", "a"), "");
  snack.give("b", "bun");
  assert.equal(snack.pass("a", "b"), "");
  assert.equal(snack.pass("a", "c"), "cocoa");
  assert.equal(snack.hand("a"), "");
  assert.equal(snack.hand("c"), "cocoa");
  assert.equal(snack.handsView().find((row) => row.id === "c").pose, "drink");
  const office = content.buildOffice();
  for (const model of ["kitchenMicrowave", "kitchenFridge"]) {
    const at = pantry.propAnchor(office.props, model);
    assert.ok(at && pantry.inPantry(at.x, at.y, office.zones), model);
  }
});

test("pantry is wired in like the other rooms and keeps everything in the meta row", () => {
  const room = roomSource();
  assert.match(room, /kind === "pantry"\) this\.onPantry/);
  assert.match(room, /pantry: this\.pantryView\(\)/);
  assert.match(room, /this\.settlePantry\(att\)/);
  assert.match(room, /if \(!inPantry\(att\.x, att\.y, this\.map\.zones\)\) return this\.pantryError/);
  assert.match(room, /if \(item\.hot\) return this\.pantryError/);
  assert.ok(!/PANTRY_META|"pantry"|stool/.test(readFileSync(join(import.meta.dirname, "../src/migrations.ts"), "utf8")));
  const client = clientSource();
  assert.match(client, /pantry\.onNet\(message\)/);
  assert.match(client, /attachPantry\(/);
  assert.match(client, /pantry\.isOpen\(\)\) return \[\];/);
  const pantryClient = readFileSync(join(import.meta.dirname, "../public/office/pantry.js"), "utf8");
  // Feature files only declare things; nothing runs when the file loads.
  for (const lineText of pantryClient.split("\n")) {
    if (!lineText || lineText.startsWith(" ") || lineText.startsWith("}") || lineText.startsWith("//")) continue;
    assert.match(lineText, /^(import |export function |const |function )/, lineText);
  }
  // Removing a sticky note asks first, with no timer.
  assert.match(pantryClient, /確定撕掉/);
  assert.match(pantryClient, /先不要/);
  const css = readFileSync(join(import.meta.dirname, "../public/office/office.css"), "utf8");
  assert.match(css, /#pantry-panel button \{ min-height: var\(--btn-h-lg\)/);
  assert.match(css, /button\.tint \{ width: 44px; min-width: 44px; min-height: 44px;/);
});
