import { spawn } from "node:child_process";
import { mkdirSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright";

const ROOT = join(import.meta.dirname, "..");
const PORT = Number(process.env.E2E_PORT || 8787);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ADMIN = "test-seed-value";
const PANEL = "/e2e-desk/panel";
const PASS = "peach-1234";
const PASS2 = "peach-9999";
const RUN = join(tmpdir(), `mini-office-e2e-${process.pid}`);
const SHOTS = join(RUN, "shots");
const ARTIFACTS = process.env.ARTIFACTS || "";
const saved = [];
// The full run splits into two halves CI can run side by side: "desk" is the desktop
// walkthrough, "phone" the phone office and the toy room. No --shard runs both.
const SHARD = process.argv.find((arg) => arg.startsWith("--shard="))?.slice("--shard=".length) || "";
if (SHARD && SHARD !== "desk" && SHARD !== "phone") throw new Error(`未知的 --shard=${SHARD}，只能是 desk 或 phone`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitHttp() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${ORIGIN}/`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("wrangler dev 沒有起來");
}

const LOOK_TAB_NAMES = ["預設", "體型", "耳朵", "尾巴", "顏色", "臉", "配件"];

async function auditLook(page, label) {
  const report = await page.evaluate((names) => {
    const problems = [];
    const card = document.querySelector("#avatar .card.wide");
    const panel = document.querySelector("#look-panel");
    const save = document.querySelector("#avatar-save");
    const tabsEl = document.querySelector("#look-tabs");
    const preview = document.querySelector("#preview");
    const heights = [];
    const saveTops = [];
    for (const name of names) {
      const tab = [...tabsEl.querySelectorAll("button")].find((button) => button.textContent === name);
      tab.click();
      const cardBox = card.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const saveBox = save.getBoundingClientRect();
      const previewBox = preview.getBoundingClientRect();
      heights.push(Math.round(panelBox.height));
      saveTops.push(Math.round(saveBox.top));
      if (card.scrollWidth > card.clientWidth + 1) problems.push(`${name} 卡片溢出 ${card.scrollWidth - card.clientWidth}`);
      if (previewBox.height < 80 || previewBox.width < 80) problems.push(`${name} 預覽太小 ${Math.round(previewBox.width)}x${Math.round(previewBox.height)}`);
      const aspect = previewBox.width / previewBox.height;
      if (Math.abs(aspect - 0.8) > 0.06) problems.push(`${name} 預覽比例 ${aspect.toFixed(2)}`);
      const bufferAspect = preview.width / preview.height;
      const boxAspect = preview.clientWidth / preview.clientHeight;
      if (Math.abs(bufferAspect - boxAspect) > 0.04) problems.push(`${name} 畫布比例 ${bufferAspect.toFixed(2)} / ${boxAspect.toFixed(2)}`);
      if (previewBox.top < cardBox.top - 1 || previewBox.bottom > cardBox.bottom + 1 || previewBox.left < cardBox.left - 1 || previewBox.right > cardBox.right + 1) {
        problems.push(`${name} 預覽超出卡片`);
      }
      if (saveBox.bottom > cardBox.bottom + 1 || saveBox.top < cardBox.top) problems.push(`${name} 進入辦公室被裁切`);
      const tabWidths = [...tabsEl.querySelectorAll("button")].map((button) => Math.round(button.getBoundingClientRect().width));
      if (Math.max(...tabWidths) - Math.min(...tabWidths) > 1) problems.push(`${name} 分頁寬度不一 ${tabWidths.join(",")}`);
      for (const grid of panel.querySelectorAll(".choice-grid")) {
        const rows = new Map();
        for (const button of grid.querySelectorAll("button")) {
          const box = button.getBoundingClientRect();
          const key = Math.round(box.top);
          if (!rows.has(key)) rows.set(key, []);
          rows.get(key).push(Math.round(box.width));
          if (button.scrollWidth > button.clientWidth + 2) problems.push(`${name} 按鈕文字溢出「${button.textContent}」`);
        }
        for (const [top, widths] of rows) {
          if (Math.max(...widths) - Math.min(...widths) > 1) problems.push(`${name} 同一列寬度不一 @${top}`);
        }
      }
      if (name === "顏色") {
        const keys = [...panel.querySelectorAll(".color-keys button")];
        const keyTops = keys.map((button) => Math.round(button.getBoundingClientRect().top));
        const keyWidths = keys.map((button) => Math.round(button.getBoundingClientRect().width));
        // Body, ears, inner ear, ear tip, tail and blush; the belly patch is no longer drawn or offered.
        if (keys.length !== 6) problems.push(`顏色子分頁 ${keys.length}`);
        if (keys.some((button) => button.textContent === "肚子")) problems.push("顏色子分頁不該有肚子");
        if (Math.max(...keyTops) - Math.min(...keyTops) > 1) problems.push("腮紅被換到下一列");
        if (Math.max(...keyWidths) - Math.min(...keyWidths) > 1) problems.push("顏色子分頁寬度不一");
        const swatch = panel.querySelector(".swatches button");
        const picker = panel.querySelector(".swatches input[type='color']");
        const swatchBox = swatch.getBoundingClientRect();
        const pickerBox = picker.getBoundingClientRect();
        const seen = (box) => box.top >= panelBox.top - 1 && box.bottom <= panelBox.bottom + 1 && box.left >= panelBox.left - 1 && box.right <= panelBox.right + 1;
        if (!seen(swatchBox)) problems.push("色塊不在可見的選項區");
        if (Math.abs(pickerBox.width - swatchBox.width) > 4 || Math.abs(pickerBox.height - swatchBox.height) > 4) {
          problems.push(`自訂色票 ${Math.round(pickerBox.width)}x${Math.round(pickerBox.height)}`);
        }
        const last = panel.querySelector(".swatches button:last-of-type").getBoundingClientRect();
        const beside = Math.abs(pickerBox.top - last.top) <= 4 && pickerBox.left >= last.left - 1;
        const below = pickerBox.top <= last.bottom + 10 && pickerBox.top >= last.top - 1;
        if (!beside && !below) problems.push("自訂色票沒有接在色塊後面");
      }
    }
    if (Math.max(...heights) - Math.min(...heights) > 1) problems.push(`選項區高度跳動 ${heights.join(",")}`);
    if (Math.max(...saveTops) - Math.min(...saveTops) > 1) problems.push(`底部按鈕跳動 ${saveTops.join(",")}`);
    return problems;
  }, LOOK_TAB_NAMES);
  assert(report.length === 0, `${label} 造型版面：${report.join("；")}`);
}

async function shot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  const file = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: file });
  saved.push({ file, name });
  console.log("shot", name);
}

async function ready(page) {
  await page.waitForFunction(() => window.office && window.office.ready, null, { timeout: 30000 });
}

// Slow CI runners load models slowly but steadily: keep waiting while files
// keep arriving, and only give up once loading stalls or runs far too long.
async function assetsReady(page, { stall = 15000, limit = 60000 } = {}) {
  const start = Date.now();
  let seen = -1;
  let moved = start;
  for (;;) {
    const state = await page.evaluate(() => ({ ready: window.office.assetsReady === true, done: window.office.assetsProgress.done }));
    if (state.ready) return;
    const now = Date.now();
    if (state.done !== seen) {
      seen = state.done;
      moved = now;
    }
    if (now - moved > stall) throw new Error(`模型載入卡在第 ${seen} 個`);
    if (now - start > limit) throw new Error(`模型載入超過 ${limit / 1000} 秒，進度 ${seen}`);
    await page.waitForTimeout(250);
  }
}

async function readLabel(page, id) {
  return page.evaluate((id) => {
    const node = document.querySelector(`.floater[data-id="${id}"]`);
    if (!node || node.hidden) return null;
    const tag = node.querySelector(".nametag")?.getBoundingClientRect();
    const bubble = node.querySelector(".bubble");
    const shown = bubble && !bubble.hidden ? bubble.getBoundingClientRect() : null;
    const head = Number(node.dataset.crown);
    if (!tag || tag.height < 8 || !Number.isFinite(head)) return null;
    return {
      gap: Math.round((head - tag.bottom) * 10) / 10,
      bubbleGap: shown ? Math.round((tag.top - shown.bottom) * 10) / 10 : null,
    };
  }, id);
}

function assertLabel(info, label) {
  assert(info && info.gap >= 4 && info.gap <= 22, `${label}名字離頭頂不對 ${JSON.stringify(info)}`);
  if (info.bubbleGap != null) assert(info.bubbleGap >= 0 && info.bubbleGap <= 12, `${label}泡泡沒有貼在名字上 ${JSON.stringify(info)}`);
}

async function settleView(page) {
  // 第一次檢查是立刻跑的，而鏡頭要到下一幀才對版面變化（例如鍵盤彈出）起反應；
  // 幀率低時前兩次取樣常在鏡頭開始動之前，所以要連續幾幀都沒動才算停好。
  await page.evaluate(() => { window.__viewSettle = null; });
  await page.waitForFunction(() => {
    const me = window.office.me;
    if (!me) return false;
    const point = window.office.worldToScreen(me.x, me.y);
    const prev = window.__viewSettle;
    const still = Boolean(prev)
      && prev.mode === window.office.cameraMode
      && Math.hypot(point.x - prev.x, point.y - prev.y) < 0.4
      && Math.abs(prev.dist - window.office.cameraDist) < 1;
    const calm = still ? prev.calm + 1 : 0;
    window.__viewSettle = { x: point.x, y: point.y, mode: window.office.cameraMode, dist: window.office.cameraDist, calm };
    return calm >= 4;
  });
}

function angleGap(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

async function dragAim(page, from, to, button = "left") {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up({ button });
  return settleHeading(page);
}

async function settleHeading(page) {
  await page.evaluate(() => { window.__headSettle = null; });
  await page.waitForFunction(() => {
    const heading = window.office.heading;
    const aim = window.office.aim;
    if (typeof heading !== "number" || typeof aim !== "number") return false;
    const prev = window.__headSettle;
    window.__headSettle = heading;
    if (typeof prev !== "number") return false;
    const step = Math.abs(Math.atan2(Math.sin(heading - prev), Math.cos(heading - prev)));
    const left = Math.abs(Math.atan2(Math.sin(heading - aim), Math.cos(heading - aim)));
    return step < 0.04 && left < 0.25;
  }, null, { timeout: 5000 });
  return page.evaluate(() => ({ heading: window.office.heading, aim: window.office.aim }));
}

// Wait until the body has finished turning toward where it is meant to face.
async function restHeading(page) {
  await page.waitForFunction(() => {
    const { heading, aim } = window.office;
    return Math.abs(Math.atan2(Math.sin(heading - aim), Math.cos(heading - aim))) < 0.02;
  }, null, { timeout: 5000 });
  return page.evaluate(() => window.office.heading);
}

async function openSpots(page, reach) {
  return page.evaluate((reach) => {
    const me = window.office.me;
    const point = window.office.worldToScreen(me.x, me.y);
    const rect = document.querySelector("#view").getBoundingClientRect();
    const left = Math.max(rect.left + 36, point.x - reach);
    const right = Math.min(rect.right - 36, point.x + reach);
    const open = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return hit === document.querySelector("#view") || hit?.closest?.("#view");
    };
    let y = point.y;
    if (!open(left, y) || !open(right, y) || !open(point.x, y)) {
      for (let yy = rect.top + 96; yy < rect.bottom - 24; yy += 16) {
        if (open(left, yy) && open(right, yy) && open(point.x, yy)) { y = yy; break; }
      }
    }
    return { left, right, mid: point.x, y };
  }, reach);
}

function lookAway(page) {
  return page.evaluate(() => {
    const gap = window.office.heading - (window.office.cameraHeading + Math.PI);
    return Math.abs(Math.atan2(Math.sin(gap), Math.cos(gap)));
  });
}

function camHeading(page) {
  return page.evaluate(() => window.office.cameraHeading);
}

async function tiltCheck(page, spot, label) {
  const lift = () => page.evaluate(() => Math.PI / 2 - window.office.cameraPitch);
  const start = await lift();
  await dragAim(page, { x: spot.left, y: spot.y }, { x: spot.left, y: spot.y + 50 });
  const raised = await lift();
  assert(raised > start + 0.05, `${label}往下拖應該讓鏡頭仰角變大，${start.toFixed(2)} → ${raised.toFixed(2)}`);
  await dragAim(page, { x: spot.left, y: spot.y + 50 }, { x: spot.left, y: spot.y });
  const lowered = await lift();
  assert(lowered < raised - 0.05, `${label}往上拖應該讓鏡頭壓低，${raised.toFixed(2)} → ${lowered.toFixed(2)}`);
  await settleView(page);
}

async function dragCamera(page, watcher, id) {
  const spot = await openSpots(page, 280);
  const still = await settleHeading(page);
  const cam = await camHeading(page);
  await page.mouse.move(spot.left, spot.y, { steps: 6 });
  await page.mouse.move(spot.right, spot.y, { steps: 6 });
  await page.waitForTimeout(700);
  const hovered = await page.evaluate(() => window.office.aim);
  assert(angleGap(still.aim, hovered) < 0.02, `只移動滑鼠不該轉向，差 ${angleGap(still.aim, hovered).toFixed(2)}`);
  assert(angleGap(cam, await camHeading(page)) < 0.02, "只移動滑鼠不該轉鏡頭");

  const before = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  const turned = await dragAim(page, { x: spot.left, y: spot.y }, { x: spot.left + 200, y: spot.y });
  const camTurned = await camHeading(page);
  assert(angleGap(cam, camTurned) > 0.5, `左鍵拖曳應該轉鏡頭，差 ${angleGap(cam, camTurned).toFixed(2)}`);
  assert(angleGap(still.heading, turned.heading) < 0.05, `俯瞰轉鏡頭時角色朝向不該跟著變，差 ${angleGap(still.heading, turned.heading).toFixed(2)}`);
  await seeHeading(watcher, id, still.aim);
  const after = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  assert(Math.hypot(after.x - before.x, after.y - before.y) < 2, "拖曳轉鏡頭時不該走動");
  const back = await dragAim(page, { x: spot.left + 200, y: spot.y }, { x: spot.left, y: spot.y });
  assert(angleGap(still.heading, back.heading) < 0.05, "俯瞰轉回鏡頭時角色朝向也不該變");

  const camBefore = await camHeading(page);
  const right = await dragAim(page, { x: spot.left, y: spot.y }, { x: spot.left + 200, y: spot.y }, "right");
  assert(angleGap(camBefore, await camHeading(page)) < 0.02, "右鍵拖曳不該轉鏡頭");
  assert(angleGap(right.aim, back.aim) < 0.02, "右鍵拖曳不該轉角色");
  await walkFacing(page, watcher, id, spot, "d");
  await walkFacing(page, watcher, id, spot, "a");
  await settleView(page);
  await tiltCheck(page, spot, "俯瞰");

  await page.getByRole("button", { name: "跟隨" }).click();
  await page.waitForFunction(() => window.office.cameraMode === "follow");
  await settleView(page);
  const followSpot = await openSpots(page, 200);
  const followStart = await settleHeading(page);
  const followCam = await camHeading(page);
  const followTurned = await dragAim(page, { x: followSpot.left, y: followSpot.y }, { x: followSpot.right, y: followSpot.y });
  await page.waitForTimeout(900);
  assert(angleGap(followCam, await camHeading(page)) > 0.7, "跟隨時左鍵拖曳應該轉鏡頭");
  assert(angleGap(followStart.heading, followTurned.heading) > 0.7, `跟隨時角色應跟著鏡頭轉，差 ${angleGap(followStart.heading, followTurned.heading).toFixed(2)}`);
  const behind = await lookAway(page);
  assert(behind < 0.3, `跟隨鏡頭應在角色背後，差 ${behind.toFixed(2)}`);
  await seeHeading(watcher, id, followTurned.aim);
  await tiltCheck(page, followSpot, "跟隨");
  await dragAim(page, { x: followSpot.right, y: followSpot.y }, { x: followSpot.left, y: followSpot.y });
  await page.getByRole("button", { name: "俯瞰" }).click();
  await page.waitForFunction(() => window.office.cameraMode === "iso");
  await settleView(page);
}

// 俯瞰: walk with a key while the mouse wanders; the body faces the walk and keeps it after stopping.
async function walkFacing(page, watcher, id, spot, key) {
  const start = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  await page.keyboard.down(key);
  const turns = [];
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(i % 2 ? spot.left : spot.right, spot.y + (i % 3) * 30, { steps: 4 });
    turns.push(await page.evaluate(() => window.office.heading));
  }
  // Read the last real step in the page: sliding along a wall bends the path, so the net move is not the walk direction.
  const walking = await page.evaluate(() => new Promise((done) => {
    const frames = [];
    const tick = () => {
      frames.push({ x: window.office.me.x, y: window.office.me.y, heading: window.office.heading });
      if (frames.length < 8) requestAnimationFrame(tick);
      else done(frames);
    };
    requestAnimationFrame(tick);
  }));
  await page.keyboard.up(key);
  const end = walking[walking.length - 1];
  assert(Math.hypot(end.x - start.x, end.y - start.y) > 20, `按 ${key} 應該走動`);
  let want = null;
  let shown = null;
  for (let i = 1; i < walking.length; i++) {
    const a = walking[i - 1];
    const b = walking[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.5) {
      want = Math.atan2(b.x - a.x, b.y - a.y);
      shown = b.heading;
    }
  }
  assert(want != null, `按 ${key} 時應該一直在走`);
  assert(angleGap(shown, want) < 0.6, `俯瞰走路時應面向走路方向，差 ${angleGap(shown, want).toFixed(2)}`);
  for (let i = 1; i < turns.length; i++) assert(angleGap(turns[i], turns[i - 1]) < 1.2, "轉身不該瞬間跳轉");
  await page.waitForTimeout(150);
  const stopped = { heading: await restHeading(page) };
  // A wall slide right before stopping can still bend the last step, so keep facing whatever it ended on.
  want = await page.evaluate(() => window.office.aim);
  for (let i = 0; i < 4; i++) await page.mouse.move(i % 2 ? spot.left : spot.right, spot.y - 40 + i * 20, { steps: 4 });
  await page.waitForTimeout(400);
  const later = await page.evaluate(() => window.office.heading);
  assert(angleGap(later, stopped.heading) < 0.05, "停下後移動滑鼠不該轉向");
  await seeHeading(watcher, id, want);
}

async function seeHeading(page, id, target) {
  await page.waitForFunction(({ id, target }) => {
    const shown = window.office.actorHeading(id);
    if (typeof shown !== "number") return false;
    return Math.abs(Math.atan2(Math.sin(shown - target), Math.cos(shown - target))) < 0.45;
  }, { id, target }, { timeout: 5000 });
  return page.evaluate((id) => window.office.actorHeading(id), id);
}

async function march(page, x, y) {
  const start = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  const points = [
    [x, start.y],
    [x, y - 48],
    [x, y],
  ];
  // Pace the steps inside the page. Separate evaluate() calls queue up while a slow runner is busy
  // drawing and then fire back to back; the server drops or rejects moves that close together
  // and snaps the player back, far from where the test expects.
  for (const [tx, ty] of points) {
    await page.evaluate(async ({ tx, ty }) => {
      const me = window.office.me;
      const from = { x: me.x, y: me.y };
      const steps = Math.max(1, Math.ceil(Math.hypot(tx - from.x, ty - from.y) / 20));
      for (let i = 1; i <= steps; i++) {
        window.office.place(from.x + ((tx - from.x) * i) / steps, from.y + ((ty - from.y) * i) / steps);
        await new Promise((resolve) => setTimeout(resolve, 45));
      }
    }, { tx, ty });
  }
}

async function walkTo(page, x, y) {
  // 伺服器拉回位置時會清掉路徑，角色停下就重新出發。
  // 幀率低時每幀的移動量有上限，軟體繪圖的 CI 上一條橫跨地圖的路要走一分鐘以上，
  // 所以不設總時限：只要還在接近目標就繼續等，一段時間都沒有更接近才算走不到。
  const started = Date.now();
  let last = null;
  let stillSince = Date.now();
  let best = Infinity;
  let bestAt = Date.now();
  await page.evaluate(({ x, y }) => window.office.walkTo(x, y), { x, y });
  while (Date.now() - bestAt < 20000) {
    const me = await page.evaluate(() => window.office.me);
    const dist = me ? Math.hypot(me.x - x, me.y - y) : Infinity;
    if (dist < 36) return;
    if (dist < best - 4) {
      best = dist;
      bestAt = Date.now();
    }
    if (!me || !last || Math.hypot(me.x - last.x, me.y - last.y) > 0.5) {
      last = me;
      stillSince = Date.now();
    } else if (Date.now() - stillSince > 1000) {
      await page.evaluate(({ x, y }) => window.office.walkTo(x, y), { x, y });
      stillSince = Date.now();
    }
    await page.waitForTimeout(100);
  }
  const where = await page.evaluate(() => {
    const me = window.office.me;
    return me ? `${me.id} @ ${Math.round(me.x)},${Math.round(me.y)}` : "no me";
  });
  const spent = Math.round((Date.now() - started) / 1000);
  throw new Error(`走不到 ${Math.round(x)},${Math.round(y)}（${where}，${spent} 秒，20 秒沒有更接近）`);
}

async function clickWalk(page, x, y) {
  const started = Date.now();
  let last = null;
  // A click that lands on furniture uses it instead of walking. When a click made no progress,
  // aim shorter and a little to the side so the next one hits the floor.
  let tries = 0;
  while (Date.now() - started < 60000) {
    const step = await page.evaluate(({ x, y, tries }) => {
      const me = window.office.me;
      const dx = x - me.x;
      const dy = y - me.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 28) return null;
      const reach = Math.min([220, 140, 90][tries % 3], dist);
      const turn = [0, 0.5, -0.5, 0.9, -0.9][Math.floor(tries / 3) % 5];
      const ux = (dx / dist) * Math.cos(turn) - (dy / dist) * Math.sin(turn);
      const uy = (dx / dist) * Math.sin(turn) + (dy / dist) * Math.cos(turn);
      const point = window.office.worldToScreen(me.x + ux * reach, me.y + uy * reach);
      const rect = document.getElementById("view").getBoundingClientRect();
      return {
        x: Math.min(rect.right - 24, Math.max(rect.left + 24, point.x)),
        y: Math.min(rect.bottom - 96, Math.max(rect.top + 78, point.y)),
        dist,
        me,
      };
    }, { x, y, tries });
    if (!step) return;
    tries = last && last.dist - step.dist < 8 ? tries + 1 : 0;
    last = step;
    await page.mouse.click(step.x, step.y);
    await page.waitForTimeout(550);
  }
  const state = await page.evaluate(() => ({
    hint: document.getElementById("hint")?.textContent || "",
    open: [...document.querySelectorAll("dialog[open], section:not([hidden]).overlay, #avatar:not([hidden]), #snack-menu:not([hidden]), #dialogue:not([hidden])")].map((node) => node.id),
    zone: window.office.zone,
    cam: window.office.cameraMode,
  }));
  throw new Error(`走不到 ${x},${y}，最後在 ${JSON.stringify({ ...last, me: { x: last?.me?.x, y: last?.me?.y }, state })}`);
}

async function tapAt(page, x, y, touch) {
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function stableScreen(page, world, key) {
  await page.evaluate(({ world, key }) => { window[key] = null; window.__stableWorld = world; }, { world, key });
  await page.waitForFunction((key) => {
    const world = window.__stableWorld;
    const screen = window.office.worldToScreen(world.x, world.y);
    const bar = document.getElementById("editbar").getBoundingClientRect().bottom;
    const stick = document.getElementById("stick")?.getBoundingClientRect();
    const floor = stick && stick.width > 0 ? stick.top - 12 : window.innerHeight - 24;
    const prev = window[key];
    window[key] = screen;
    if (!prev) return false;
    const still = Math.hypot(screen.x - prev.x, screen.y - prev.y) < 0.5;
    const clear = screen.x > 20 && screen.x < window.innerWidth - 20 && screen.y > bar + 16 && screen.y < floor;
    return still && clear;
  }, key);
  return page.evaluate((world) => window.office.worldToScreen(world.x, world.y), world);
}

async function editFurniture(page, { touch, witness, shotName, leave }) {
  if ((await page.evaluate(() => window.office.cameraMode)) !== "iso") {
    const toggle = page.locator("#cam-btn");
    if (await toggle.isVisible()) await toggle.click();
    else await page.locator("#cam-iso").click();
    await page.waitForFunction(() => window.office.cameraMode === "iso");
  }
  if (!(await page.evaluate(() => window.office.editing))) {
    await march(page, 224, 208);
    await page.waitForFunction(() => {
      const me = window.office.me;
      return Math.hypot(me.x - 224, me.y - 116) < 112;
    });
    if (touch) await page.getByRole("button", { name: "跟 Lala 說話" }).click();
    else await page.keyboard.press("e");
    await page.getByRole("button", { name: "調整設備擺設" }).click();
    await page.waitForFunction(() => window.office.editing);
  }
  const hint = await page.locator("#edit-hint").textContent();
  const phone = await page.evaluate(() => window.office.phone);
  if (phone) assert(!/R|Delete|鍵盤/.test(hint || ""), `手機編輯說明不該只靠鍵盤 ${hint}`);
  else assert(/R/.test(hint || "") && /Delete/.test(hint || ""), `桌面說明應保留快捷鍵 ${hint}`);
  const barFit = await page.evaluate(() => {
    const bar = document.getElementById("editbar").getBoundingClientRect();
    const palette = document.getElementById("palette");
    const box = palette.getBoundingClientRect();
    const clipped = [...palette.querySelectorAll("button")].filter((node) => {
      const b = node.getBoundingClientRect();
      return b.height < 28 || b.top < box.top - 2 || b.bottom > box.bottom + 2;
    }).map((node) => node.textContent);
    return {
      clipped,
      count: palette.querySelectorAll("button").length,
      barH: bar.height,
      vh: window.innerHeight,
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  assert(barFit.count >= 15, `設備清單不完整 ${barFit.count}`);
  assert(barFit.clipped.length === 0, `設備清單被裁切 ${barFit.clipped.join(",")}`);
  assert(barFit.barH < barFit.vh * 0.42, `編輯列蓋住太多畫面 ${Math.round(barFit.barH)}/${barFit.vh}`);
  assert(barFit.wide <= 1, `編輯列造成橫向溢出 ${barFit.wide}`);

  const before = await witness.evaluate(() => window.office.furniture.map((item) => item.id));
  const spot = { x: 360, y: 200 };
  await page.locator("#palette button", { hasText: "仙人掌" }).click();
  await page.waitForFunction(() => window.office.armed === "cactus" && !document.getElementById("furn-cancel").disabled);
  await page.evaluate((spot) => window.office.focusOn(spot.x, spot.y), spot);
  const screen = await stableScreen(page, spot, "__addStable");
  const heightBefore = await page.locator("#editbar").evaluate((node) => Math.round(node.getBoundingClientRect().height));
  await tapAt(page, screen.x, screen.y, touch);
  await witness.waitForFunction((ids) => window.office.furniture.some((item) => item.kind === "cactus" && !ids.includes(item.id)), before);
  await page.waitForFunction(() => !window.office.armed);
  const first = await witness.evaluate((ids) => window.office.furniture.find((item) => item.kind === "cactus" && !ids.includes(item.id)), before);

  await page.locator("#palette button", { hasText: "仙人掌" }).click();
  await page.waitForFunction(() => window.office.armed === "cactus");
  const again = await stableScreen(page, { x: first.x + 10, y: first.y + 14 }, "__addAgain");
  await tapAt(page, again.x, again.y, touch);
  await witness.waitForFunction((ids) => window.office.furniture.filter((item) => item.kind === "cactus" && !ids.includes(item.id)).length >= 2, before);
  await page.waitForFunction(() => !window.office.armed);
  const added = await witness.evaluate((ids) => window.office.furniture.filter((item) => item.kind === "cactus" && !ids.includes(item.id)), before);

  const pick = added[added.length - 1];
  const selectAt = await stableScreen(page, { x: pick.x + 10, y: pick.y + 14 }, "__selectStable");
  await tapAt(page, selectAt.x, selectAt.y, touch);
  await page.waitForFunction((id) => window.office.selected === id && !document.getElementById("furn-rot").disabled, pick.id);
  const heightAfter = await page.locator("#editbar").evaluate((node) => Math.round(node.getBoundingClientRect().height));
  assert(heightBefore === heightAfter, `選取設備時編輯列高度跳動 ${heightBefore} -> ${heightAfter}`);
  const tools = await page.evaluate(() => ({
    label: document.getElementById("furn-tools-label").textContent,
    rot: document.getElementById("furn-rot").getBoundingClientRect().height,
    remove: document.getElementById("furn-remove").getBoundingClientRect().height,
  }));
  assert(tools.label.includes("仙人掌"), `選取說明不對 ${tools.label}`);
  assert(tools.rot >= 40 && tools.remove >= 40, `旋轉或收回按鈕太小 ${JSON.stringify(tools)}`);
  await shot(page, shotName);

  await page.locator("#furn-rot").click();
  await witness.waitForFunction((id) => {
    const item = window.office.furniture.find((furn) => furn.id === id);
    return item && item.rot === 90;
  }, pick.id);
  await page.locator("#furn-remove").click();
  await witness.waitForFunction((id) => !window.office.furniture.some((item) => item.id === id), pick.id);
  const other = added.find((item) => item.id !== pick.id);
  const otherAt = await stableScreen(page, { x: other.x + 10, y: other.y + 14 }, "__otherStable");
  await tapAt(page, otherAt.x, otherAt.y, touch);
  await page.waitForFunction((id) => window.office.selected === id, other.id);
  await page.locator("#furn-remove").click();
  await witness.waitForFunction((id) => !window.office.furniture.some((item) => item.id === id), other.id);

  await page.locator("#palette button", { hasText: "仙人掌" }).click();
  await page.evaluate(() => window.office.focusOn(200, 16));
  await page.waitForTimeout(400);
  const bad = await page.evaluate(() => {
    const bar = document.getElementById("editbar").getBoundingClientRect().bottom;
    const stick = document.getElementById("stick")?.getBoundingClientRect();
    const floor = stick && stick.width > 0 ? stick.top - 12 : window.innerHeight - 16;
    for (let y = bar + 12; y < floor; y += 18) {
      for (let x = 16; x < window.innerWidth - 16; x += 28) {
        const world = window.office.screenToWorld(x, y);
        if (world.y < 0 || world.x < 0) return { x, y, world };
      }
    }
    return null;
  });
  assert(bad, "畫面上找不到放不進去的位置");
  await tapAt(page, bad.x, bad.y, touch);
  await page.waitForFunction(() => (document.getElementById("hint").textContent || "").includes("放不進去"));
  assert(await page.evaluate(() => window.office.armed === "cactus" && !document.getElementById("furn-cancel").disabled), "放不進去不該取消準備放置");
  const count = await witness.evaluate((ids) => window.office.furniture.filter((item) => !ids.includes(item.id)).length, before);
  assert(count === 0, `放不進去卻多了設備 ${count}`);
  await page.locator("#furn-cancel").click();
  await page.waitForFunction(() => !window.office.armed && document.getElementById("furn-cancel").disabled);
  if (leave) {
    await page.locator("#edit-done").click();
    await page.waitForFunction(() => !window.office.editing);
  }
}

async function register(page, id, name, animal) {
  await page.goto(`${ORIGIN}/`);
  await page.getByLabel("辦公室密碼").fill(PASS);
  await page.getByRole("button", { name: "進入", exact: true }).click();
  await page.getByLabel("你的 ID").waitFor();
  await page.getByLabel("你的 ID").fill(id);
  await page.locator("#office-name").fill(name);
  if (id === "naco") await shot(page, "register-id");
  const registered = page.waitForResponse((res) => res.url().includes("/api/office/register") && res.request().method() === "POST");
  await page.getByRole("button", { name: "下一步" }).click();
  const response = await registered;
  if (id === "naco") {
    const body = await response.json();
    assert(!Object.hasOwn(body, "token"), "登記不該把權杖交給網頁");
    const session = (await page.context().cookies()).find((cookie) => cookie.name === "office_session");
    assert(session?.httpOnly === true, "登入 cookie 應該是 HttpOnly");
    assert(!(await page.evaluate(() => document.cookie.includes("office_session"))), "網頁不該讀得到登入 cookie");
  }
  await page.getByRole("button", { name: animal, exact: true }).click();
  if (id === "naco") {
    const rejected = await page.evaluate(async () => {
      const result = await window.office.ask("setup", { animal: "custom", look: { v: 2, body: "nope", colors: { body: "red" } } });
      return result.status;
    });
    assert(rejected === 400, `不合法造型應為 400，實際 ${rejected}`);
    await page.getByRole("button", { name: "耳朵", exact: true }).click();
    await page.getByRole("button", { name: "尖耳", exact: true }).click();
    await page.getByRole("button", { name: "配件", exact: true }).click();
    await shot(page, "style-customizer");
    await shot(page, "style2-customizer");
    await page.getByRole("button", { name: "顏色", exact: true }).click();
    await page.getByRole("button", { name: "身體", exact: true }).waitFor();
    const preview3d = await page.evaluate(() => window.office.preview3d === true);
    assert(preview3d, "造型預覽應該用 WebGL 畫出 3D 角色");
    await shot(page, "customizer");
    await shot(page, "desktop-customizer");
    const lookViews = [
      { width: 1440, height: 900, label: "1440x900", shot: "customizer-desktop" },
      { width: 1024, height: 768, label: "1024x768", shot: "customizer-1024" },
      { width: 390, height: 844, label: "390x844", shot: "customizer-phone-portrait" },
      { width: 844, height: 390, label: "844x390", shot: "customizer-phone-landscape" },
    ];
    for (const view of lookViews) {
      await page.setViewportSize({ width: view.width, height: view.height });
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "顏色", exact: true }).click();
      await page.getByRole("button", { name: "身體", exact: true }).waitFor();
      await shot(page, view.shot);
      await auditLook(page, view.label);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "配件", exact: true }).click();
    await page.getByRole("button", { name: "毛帽" }).click();
    await shot(page, "avatar-chooser");
  }
  await page.getByRole("button", { name: "進入辦公室" }).click();
  await ready(page);
}

async function holdPointer(page, selector, dx, dy) {
  await page.evaluate(async ({ selector, dx, dy }) => {
    const node = document.querySelector(selector);
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const fire = (type, cx, cy, id = 1) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: "touch",
      clientX: cx,
      clientY: cy,
      isPrimary: id === 1,
    }));
    fire("pointerdown", x, y);
    fire("pointermove", x + dx, y + dy);
    window.__held = { selector, x: x + dx, y: y + dy };
  }, { selector, dx, dy });
}

async function releasePointer(page) {
  await page.evaluate(() => {
    const held = window.__held;
    if (!held) return;
    document.querySelector(held.selector).dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: 1,
      pointerType: "touch",
      clientX: held.x,
      clientY: held.y,
    }));
    window.__held = null;
  });
}

async function topbarGap(page) {
  return page.evaluate(() => {
    const left = document.querySelector(".top-left").getBoundingClientRect();
    const right = document.querySelector(".top-right").getBoundingClientRect();
    const x = (left.right + right.left) / 2;
    const y = (left.top + left.bottom) / 2;
    return { gap: right.left - left.right, hit: document.elementFromPoint(x, y)?.id || null };
  });
}

async function overlaps(page, selectors) {
  return page.evaluate((names) => {
    const boxes = names.map((name) => {
      const node = document.querySelector(name);
      if (!node || node.hidden) return null;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return null;
      const box = node.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return null;
      return { name, x: box.x, y: box.y, r: box.right, b: box.bottom };
    }).filter(Boolean);
    const hits = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.x < b.r - 1 && a.r > b.x + 1 && a.y < b.b - 1 && a.b > b.y + 1) hits.push(`${a.name}×${b.name}`);
      }
    }
    return hits;
  }, selectors);
}

async function phoneRegister(page, password, id, name, animal) {
  await page.goto(`${ORIGIN}/`);
  await page.getByLabel("辦公室密碼").fill(password);
  await page.getByRole("button", { name: "進入", exact: true }).click();
  await page.getByLabel("你的 ID").fill(id);
  await page.locator("#office-name").fill(name);
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: animal, exact: true }).click();
}

async function touchGesture(page, tracks, holdMs) {
  return page.evaluate(async ({ tracks, holdMs }) => {
    const view = document.querySelector("#view");
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const fire = (type, id, x, y) => view.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      isPrimary: id === tracks[0].id,
    }));
    for (const track of tracks) fire("pointerdown", track.id, track.from.x, track.from.y);
    await wait(holdMs);
    for (let step = 1; step <= 10; step++) {
      for (const track of tracks) {
        fire("pointermove", track.id, track.from.x + ((track.to.x - track.from.x) * step) / 10, track.from.y + ((track.to.y - track.from.y) * step) / 10);
      }
      await wait(16);
    }
    for (const track of tracks) fire("pointerup", track.id, track.to.x, track.to.y);
    return true;
  }, { tracks, holdMs });
}

async function phoneCamera(browser) {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  await phoneRegister(page, PASS, "pico", "皮可", "貓");
  await page.getByRole("button", { name: "進入辦公室" }).click();
  await ready(page);
  await settleView(page);
  const spot = await openSpots(page, 120);
  const from = { x: spot.left, y: spot.y };
  const to = { x: spot.left + 150, y: spot.y };
  const where = () => page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));

  const cam = await camHeading(page);
  const start = await where();
  const lift = () => page.evaluate(() => Math.PI / 2 - window.office.cameraPitch);
  const liftStart = await lift();
  await touchGesture(page, [{ id: 30, from, to: { x: from.x + 4, y: from.y + 1 } }], 0);
  assert(angleGap(cam, await camHeading(page)) < 0.02, "小幅移動不該轉鏡頭");
  await page.waitForFunction((origin) => {
    const me = window.office.me;
    return Math.hypot(me.x - origin.x, me.y - origin.y) > 10;
  }, start, { timeout: 4000 });
  await page.evaluate((origin) => window.office.place(origin.x, origin.y), start);
  const headingStart = await restHeading(page);

  await touchGesture(page, [{ id: 31, from, to: { x: to.x, y: to.y + 70 } }], 0);
  await page.waitForTimeout(300);
  const camTurned = await camHeading(page);
  assert(angleGap(cam, camTurned) > 0.4, `直接滑動應該轉鏡頭，差 ${angleGap(cam, camTurned).toFixed(2)}`);
  assert((await lift()) > liftStart + 0.05, "往下拖應該讓仰角變大");
  const still = await where();
  assert(Math.hypot(still.x - start.x, still.y - start.y) < 2, "滑動轉鏡頭不該走動");
  await settleHeading(page);
  const turnedHeading = await restHeading(page);
  assert(angleGap(headingStart, turnedHeading) < 0.05, "手機俯瞰轉鏡頭時角色朝向不該跟著變");
  await shot(page, "phone-swipe-rotate");

  const dist = await page.evaluate(() => window.office.cameraDist);
  const cx = spot.mid;
  await touchGesture(page, [
    { id: 33, from: { x: cx - 30, y: spot.y }, to: { x: cx - 110, y: spot.y + 30 } },
    { id: 34, from: { x: cx + 30, y: spot.y }, to: { x: cx + 110, y: spot.y + 30 } },
  ], 0);
  const zoomed = await page.evaluate(() => window.office.cameraDist);
  assert(zoomed < dist - 10, `雙指拉開應該拉近，${dist.toFixed(0)} → ${zoomed.toFixed(0)}`);
  assert(angleGap(camTurned, await camHeading(page)) < 0.02, "雙指移動不該轉鏡頭");

  const stickCam = await camHeading(page);
  await holdPointer(page, "#stick", 0, -52);
  await page.waitForTimeout(120);
  assert(angleGap(stickCam, await camHeading(page)) < 0.02, "手指在搖桿上不該轉鏡頭");
  const stickAt = await where();
  await touchGesture(page, [{ id: 35, from: { x: spot.right, y: spot.y }, to: { x: spot.left, y: spot.y } }], 0);
  const stickMoved = await where();
  assert(angleGap(stickCam, await camHeading(page)) > 0.35, "按著搖桿時另一指滑動應該轉鏡頭");
  assert(Math.hypot(stickMoved.x - stickAt.x, stickMoved.y - stickAt.y) > 12, "按著搖桿滑動時人應該同時移動");
  await releasePointer(page);
  await page.evaluate((origin) => window.office.place(origin.x, origin.y), start);

  const chair = await page.evaluate(() => {
    const me = window.office.me;
    let best = null;
    for (const item of window.office.furniture) {
      if (item.kind !== "chair" || item.seat) continue;
      const spot = { id: item.id, x: item.x + 16, y: item.y + 36 };
      const dist = Math.hypot(spot.x - me.x, spot.y - me.y);
      if (!best || dist < best.dist) best = { ...spot, dist };
    }
    return best;
  });
  // Walk with the game's own path: a straight march from above the desk cuts through it,
  // the client pushes the player around the desk and the server snaps that jump back.
  await walkTo(page, chair.x, chair.y);
  const sitButton = page.getByRole("button", { name: "坐下" });
  await sitButton.waitFor({ timeout: 5000 }).catch(async () => {
    const me = await page.evaluate(() => window.office.me);
    throw new Error(`走到椅子旁邊卻沒有坐下按鈕 ${JSON.stringify({ chair, me: { x: me.x, y: me.y } })}`);
  });
  await sitButton.click();
  await page.waitForFunction((id) => window.office.seat === id, chair.id);
  await settleView(page);
  await page.evaluate(() => window.office.setView({ pitch: 0.78 }));
  const seatSpot = await openSpots(page, 100);
  const seatFrom = { x: seatSpot.left, y: seatSpot.y };
  const seatTo = { x: seatSpot.right, y: seatSpot.y };
  const seatedAt = await where();
  const seatedCam = await camHeading(page);
  const seatedLift = await lift();
  const seatId = await page.evaluate(() => window.office.seat);
  await touchGesture(page, [{ id: 41, from: seatFrom, to: { x: seatTo.x, y: seatTo.y + 50 } }], 0);
  assert(angleGap(seatedCam, await camHeading(page)) > 0.4, "坐著滑動應該轉鏡頭");
  assert((await lift()) > seatedLift + 0.05, "坐著往下拖應該讓仰角變大");
  const stayed = await where();
  assert((await page.evaluate(() => window.office.seat)) === seatId, "轉鏡頭不該起立");
  assert(Math.hypot(stayed.x - seatedAt.x, stayed.y - seatedAt.y) < 2, "坐著轉鏡頭不該滑走");
  if ((await page.evaluate(() => window.office.cameraMode)) !== "follow") await page.locator("#cam-btn").click();
  await page.waitForFunction(() => window.office.cameraMode === "follow");
  await settleView(page);
  const followCam = await camHeading(page);
  const followSpot = await openSpots(page, 100);
  await touchGesture(page, [{ id: 42, from: { x: followSpot.left, y: followSpot.y }, to: { x: followSpot.right, y: followSpot.y } }], 0);
  await page.waitForTimeout(900);
  assert(angleGap(followCam, await camHeading(page)) > 0.5, "坐著跟隨鏡頭不該轉完彈回去");
  assert((await page.evaluate(() => window.office.seat)) === seatId, "跟隨轉鏡頭不該起立");
  const seatDist = await page.evaluate(() => window.office.cameraDist);
  const pinchX = followSpot.mid;
  await touchGesture(page, [
    { id: 43, from: { x: pinchX - 30, y: followSpot.y }, to: { x: pinchX - 110, y: followSpot.y + 20 } },
    { id: 44, from: { x: pinchX + 30, y: followSpot.y }, to: { x: pinchX + 110, y: followSpot.y + 20 } },
  ], 0);
  const seatZoom = await page.evaluate(() => window.office.cameraDist);
  assert(seatZoom < seatDist - 10, `坐著雙指應該拉近，${seatDist.toFixed(0)} → ${seatZoom.toFixed(0)}`);
  assert((await page.evaluate(() => window.office.seat)) === seatId, "縮放不該起立");
  const parked = await where();
  assert(Math.hypot(parked.x - seatedAt.x, parked.y - seatedAt.y) < 2, "坐著縮放不該滑走");

  await page.close();
  await context.close();
}

async function mobileOffice(browser, password) {
  const iphone = await browser.newContext({ ...devices["iPhone 13"] });
  const yuki = await iphone.newPage();
  yuki.on("pageerror", (error) => console.log("PAGE", error.message));
  await phoneRegister(yuki, password, "yuki", "雪", "貓");
  const overflow = await yuki.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `造型頁橫向溢出 ${overflow}`);
  const clipped = await yuki.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return ["#preview", "#avatar-name", "#look-tabs"].some((sel) => {
      const box = document.querySelector(sel).getBoundingClientRect();
      return box.left < -1 || box.right > width + 1;
    });
  });
  assert(!clipped, "造型預覽、名稱或分頁超出畫面");
  const tabsFit = await yuki.locator("#look-tabs").evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
  assert(tabsFit, "造型分頁不該橫向溢出");
  await yuki.getByRole("button", { name: "顏色", exact: true }).click();
  const swatch = yuki.locator(".swatches button").first();
  const swatchBox = await swatch.boundingBox();
  assert(swatchBox && swatchBox.width >= 40 && swatchBox.height >= 40, "色塊不夠大");
  await swatch.click();
  await shot(yuki, "phone-customizer");
  await yuki.getByRole("button", { name: "進入辦公室" }).click();
  await ready(yuki);
  await yuki.locator("#stick").waitFor();
  await yuki.locator("#chat-toggle").waitFor();
  const stickBox = await yuki.locator("#stick").boundingBox();
  const camBox = await yuki.locator("#cam-btn").boundingBox();
  assert(stickBox && stickBox.width >= 80, "搖桿沒有出現");
  assert(camBox && camBox.height >= 44 && camBox.height <= 46, "鏡頭按鈕尺寸不對");
  const ratio = await yuki.evaluate(() => window.office.pixelRatio);
  assert(ratio <= 1.25, `手機像素比應壓到 1.25，實際 ${ratio}`);
  const framed = await yuki.evaluate(() => window.office.cameraDist);
  const home = await yuki.evaluate(() => window.office.homeDist());
  assert(framed >= 760 && framed <= 860 && Math.abs(framed - home) < 1, `直向鏡頭距離不對 ${framed}`);
  const fogNear = await yuki.evaluate(() => window.office.fogNear);
  assert(fogNear >= framed, `霧比鏡頭近，人物會發灰 ${fogNear} / ${framed}`);
  const barHeight = await yuki.evaluate(() => document.querySelector("#topbar").getBoundingClientRect().height);
  assert(barHeight <= 64, `頂部列太高 ${barHeight}`);
  await yuki.setViewportSize({ width: 390, height: 844 });
  await yuki.locator("#online-chip").waitFor();
  const portraitBar = await yuki.evaluate(() => document.querySelector("#topbar").getBoundingClientRect().height);
  assert(portraitBar <= 64, `直向頂部列換行了 ${portraitBar}`);
  const portraitGap = await topbarGap(yuki);
  assert(portraitGap.gap >= 8 && portraitGap.hit === "view", `直向頂部左右兩塊重疊或擋住場景 ${JSON.stringify(portraitGap)}`);
  await shot(yuki, "header-phone-portrait");
  await shot(yuki, "style-phone-portrait");
  await assetsReady(yuki).catch(() => {});
  await shot(yuki, "style2-phone-portrait");
  await yuki.setViewportSize({ width: 390, height: 664 });

  const before = await yuki.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  await holdPointer(yuki, "#stick", 0, -48);
  await yuki.waitForFunction((start) => {
    const me = window.office.me;
    return Math.hypot(me.x - start.x, me.y - start.y) > 36;
  }, before);
  await releasePointer(yuki);

  const yaw = await yuki.evaluate(() => window.office.cameraYaw);
  await yuki.evaluate(() => {
    const canvas = document.querySelector("#view");
    const fire = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      isPrimary: true,
    }));
    fire("pointerdown", 180, 320);
    fire("pointermove", 260, 330);
    fire("pointerup", 260, 330);
  });
  const yawAfter = await yuki.evaluate(() => window.office.cameraYaw);
  assert(Math.abs(yawAfter - yaw) > 0.05, `單指沒有轉動鏡頭 ${yaw} -> ${yawAfter}`);

  const dist = await yuki.evaluate(() => window.office.cameraDist);
  await yuki.evaluate(() => {
    const canvas = document.querySelector("#view");
    const fire = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      isPrimary: id === 3,
    }));
    fire("pointerdown", 3, 120, 300);
    fire("pointerdown", 4, 220, 300);
    fire("pointermove", 3, 40, 300);
    fire("pointermove", 4, 320, 300);
    fire("pointerup", 3, 40, 300);
    fire("pointerup", 4, 320, 300);
  });
  const distAfter = await yuki.evaluate(() => window.office.cameraDist);
  assert(Math.abs(distAfter - dist) > 20, `雙指沒有縮放 ${dist} -> ${distAfter}`);

  const mode = await yuki.evaluate(() => window.office.cameraMode);
  await yuki.locator("#cam-btn").click();
  await yuki.waitForFunction((prev) => window.office.cameraMode !== prev, mode);
  await yuki.locator("#cam-btn").click();

  const chair = await yuki.evaluate(() => {
    const me = window.office.me;
    let best = null;
    for (const item of window.office.furniture) {
      if (item.kind !== "chair" || item.seat) continue;
      const spot = { id: item.id, x: item.x + 16, y: item.y + 36 };
      const dist = Math.hypot(spot.x - me.x, spot.y - me.y);
      if (!best || dist < best.dist) best = { ...spot, dist };
    }
    return best;
  });
  await march(yuki, chair.x, chair.y);
  const sit = yuki.getByRole("button", { name: "坐下" });
  await sit.waitFor();
  const sitBox = await sit.boundingBox();
  assert(sitBox && sitBox.height >= 44 && sitBox.height <= 52 && sitBox.width >= 44, "坐下按鈕尺寸不對");
  const sitHint = await yuki.locator("#hint").textContent();
  assert(!/按 [EF]/.test(sitHint || ""), `手機不該出現按鍵提示 ${sitHint}`);
  await yuki.evaluate((dist) => window.office.setView({ dist }), home);
  await settleView(yuki);
  const docked = await overlaps(yuki, ["#stick", "#chat-toggle", "#actions", "#topbar"]);
  assert(docked.length === 0, `直向按鈕重疊 ${docked.join(" ")}`);
  assert((await yuki.locator("#hint").boundingBox()) == null, "空的提示不該變成白塊");
  await shot(yuki, "phone-office-portrait");
  await settleView(yuki);
  assertLabel(await readLabel(yuki, "yuki"), "手機俯瞰 ");
  await yuki.locator("#cam-btn").click();
  await yuki.waitForFunction(() => window.office.cameraMode === "follow");
  await settleView(yuki);
  assertLabel(await readLabel(yuki, "yuki"), "手機跟隨 ");
  await yuki.locator("#cam-btn").click();
  await yuki.waitForFunction(() => window.office.cameraMode === "iso");
  await settleView(yuki);
  await yuki.locator("#chat-toggle").click();
  await yuki.locator("#chat-input").fill("手機午安");
  await yuki.locator("#chat-input").press("Enter");
  await yuki.waitForFunction(() => window.office.bubbles.some((bubble) => bubble.text.includes("手機午安")));
  const phoneLife = await yuki.evaluate(() => {
    const bubble = window.office.bubbles.find((item) => item.text.includes("手機午安"));
    return bubble ? bubble.until - performance.now() : -1;
  });
  assert(phoneLife > 5500 && phoneLife < 8500, `手機泡泡時間不對 ${phoneLife}`);
  assertLabel(await readLabel(yuki, "yuki"), "手機泡泡 ");
  await shot(yuki, "label-phone");
  if ((await yuki.locator("#chat-toggle").textContent()) === "收起") await yuki.locator("#chat-toggle").click();
  await sit.click();
  await yuki.waitForFunction((id) => window.office.seat === id, chair.id);
  await yuki.getByRole("button", { name: "起立" }).click();
  await yuki.waitForFunction(() => !window.office.seat);

  await yuki.locator("#chat-toggle").click();
  await yuki.locator("#chat-input").waitFor();
  const chatBefore = await yuki.locator("#chatbar").boundingBox();
  await yuki.evaluate(() => window.office.applyKeyboardInset(220));
  const chatAfter = await yuki.locator("#chatbar").boundingBox();
  assert(chatAfter && chatBefore && chatAfter.y < chatBefore.y - 100, "鍵盤會蓋住聊天框");
  await settleView(yuki);
  const tag = await yuki.evaluate(() => {
    const me = document.querySelector(`.floater[data-id="${window.office.me.id}"]`);
    const bar = document.querySelector("#chatbar").getBoundingClientRect();
    const box = me.getBoundingClientRect();
    const top = document.querySelector("#topbar").getBoundingClientRect();
    return { bottom: box.bottom, barTop: bar.top, tagTop: box.top, topBottom: top.bottom, hidden: me.hidden };
  });
  assert(!tag.hidden && tag.bottom < tag.barTop - 4, `名字被聊天框蓋住 ${JSON.stringify(tag)}`);
  assert(tag.tagTop >= tag.topBottom - 2, `直向名字被頂部列蓋住 ${JSON.stringify(tag)}`);
  await shot(yuki, "phone-chat");
  await yuki.evaluate(() => window.office.applyKeyboardInset(null));
  await yuki.locator("#chat-input").fill("手機午安");
  await yuki.locator("#chat-input").press("Enter");
  await yuki.waitForFunction(() => window.office.bubbles.some((bubble) => bubble.text.includes("手機午安")));

  const android = await browser.newContext({
    viewport: { width: 360, height: 740 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 12; Pixel 4a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  });
  const kuma = await android.newPage();
  await phoneRegister(kuma, password, "kuma", "熊", "兔");
  const androidClip = await kuma.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return ["#preview", "#avatar-name", "#look-tabs"].some((sel) => {
      const box = document.querySelector(sel).getBoundingClientRect();
      return box.left < -1 || box.right > width + 1 || document.documentElement.scrollWidth > width + 1;
    });
  });
  assert(!androidClip, "安卓造型頁超出畫面");
  await kuma.getByRole("button", { name: "進入辦公室" }).click();
  await ready(kuma);
  await kuma.locator("#stick").waitFor();
  const androidWide = await kuma.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(androidWide <= 1, `安卓頁面橫向溢出 ${androidWide}`);

  await march(yuki, 520, 340);
  await march(kuma, 590, 340);
  await yuki.getByRole("button", { name: "說悄悄話" }).click();
  await yuki.waitForFunction(() => window.office.group.includes("kuma") && window.office.group.length === 2);
  await kuma.waitForFunction(() => window.office.group.includes("yuki"));
  await yuki.locator("#chat-whisper-label").waitFor();
  await yuki.locator("#chat-whisper").click();
  await yuki.locator("#chat-whisper-list").waitFor();
  const whisperHits = await overlaps(yuki, ["#stick", "#chat-toggle", "#actions", "#chatbar", "#topbar"]);
  const listHits = await overlaps(yuki, ["#chat-whisper-list", "#stick", "#chat-toggle", "#actions"]);
  assert(whisperHits.length === 0 && listHits.length === 0, `悄悄話和搖桿重疊 ${[...whisperHits, ...listHits].join(" ")}`);
  const whisperHint = await yuki.locator("#hint").textContent();
  assert(!/按 [EF]/.test(whisperHint || ""), `手機不該出現按鍵提示 ${whisperHint}`);
  if (!whisperHint?.trim()) assert((await yuki.locator("#hint").boundingBox()) == null, "空的提示不該變成白塊");
  await shot(yuki, "phone-whisper");

  const rinContext = await browser.newContext({ ...devices["iPhone 13"] });
  const rin = await rinContext.newPage();
  await phoneRegister(rin, password, "rin", "鈴", "狗");
  await rin.getByRole("button", { name: "進入辦公室" }).click();
  await ready(rin);
  await march(rin, 660, 340);
  // A button that did not change must stay the same element when another one shows up beside it,
  // or a tap that is already on its way lands on a node that has just been thrown away.
  const joinButton = await rin.getByRole("button", { name: "加入悄悄話" }).elementHandle();
  const besideChair = await rin.evaluate(() => {
    const kuma = window.office.others.find((person) => person.id === "kuma");
    for (const item of window.office.furniture) {
      if (item.kind !== "chair") continue;
      for (let i = 0; i < 32; i++) {
        const x = item.x + 16 + Math.cos((i / 32) * Math.PI * 2) * 55;
        const y = item.y + 13 + Math.sin((i / 32) * Math.PI * 2) * 55;
        const gap = Math.hypot(x - kuma.x, y - kuma.y);
        if (gap > 70 && gap < 95) return { x, y };
      }
    }
    return null;
  });
  assert(besideChair, "找不到在悄悄話範圍內又靠近椅子的位置");
  await rin.evaluate(({ x, y }) => window.office.place(x, y), besideChair);
  await rin.waitForFunction(() => window.office.actions.includes("坐下"));
  assert(await joinButton.evaluate((button) => button.isConnected), "多出坐下按鈕時，加入悄悄話按鈕被重建了");
  await rin.getByRole("button", { name: "加入悄悄話" }).click();
  const accept = yuki.getByRole("button", { name: "答應" });
  await accept.waitFor();
  const acceptBox = await accept.boundingBox();
  assert(acceptBox && acceptBox.height >= 44 && acceptBox.height <= 52, "加入請求的按鈕尺寸不對");
  await accept.click();
  await rin.waitForFunction(() => window.office.group.includes("rin") && window.office.group.length === 3);

  await yuki.setViewportSize({ width: 844, height: 390 });
  await yuki.locator("#stick").waitFor();
  await yuki.evaluate((dist) => window.office.setView({ dist }), await yuki.evaluate(() => window.office.homeDist()));
  await settleView(yuki);
  const landWide = await yuki.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(landWide <= 1, `橫向畫面溢出 ${landWide}`);
  const landHits = await overlaps(yuki, ["#stick", "#chat-toggle", "#actions", "#chatbar", "#topbar"]);
  const landList = await overlaps(yuki, ["#chat-whisper-list", "#stick", "#chat-toggle", "#actions"]);
  assert(landHits.length === 0 && landList.length === 0, `橫向畫面重疊 ${[...landHits, ...landList].join(" ")}`);
  const landBar = await yuki.locator("#chatbar").boundingBox();
  const landHeight = yuki.viewportSize().height;
  assert(landBar && landBar.height >= 64 && landBar.height <= 100, `橫向悄悄話列高度不對 ${landBar?.height}`);
  assert(landBar && landBar.y > landHeight * 0.4, `橫向聊天框蓋住畫面中間 ${landBar?.y}`);
  const landRows = await yuki.evaluate(() => {
    const label = document.querySelector("#chat-whisper").getBoundingClientRect();
    const input = document.querySelector("#chat-input").getBoundingClientRect();
    const bar = document.querySelector("#chatbar").getBoundingClientRect();
    const tag = document.querySelector(`.floater[data-id="${window.office.me.id}"]`);
    const top = document.querySelector("#topbar").getBoundingClientRect();
    const tagBox = tag.getBoundingClientRect();
    return {
      split: input.top >= label.bottom - 2,
      inputWide: input.width > bar.width * 0.55,
      tagTop: tagBox.top,
      barBottom: top.bottom,
      tagHidden: tag.hidden,
    };
  });
  assert(landRows.split, "橫向悄悄話的名字和輸入框不該同一列");
  assert(landRows.inputWide, "橫向輸入框太短");
  assert(!landRows.tagHidden && landRows.tagTop >= landRows.barBottom - 2, `橫向名字被頂部列蓋住 ${JSON.stringify(landRows)}`);
  const landTags = await yuki.evaluate(() => {
    const top = document.querySelector("#topbar").getBoundingClientRect().bottom;
    const bar = document.querySelector("#chatbar").getBoundingClientRect().top;
    const me = window.office.me;
    const mine = document.querySelector(`.floater[data-id="${me.id}"]`).getBoundingClientRect();
    const body = window.office.worldToScreen(me.x, me.y).y - mine.bottom;
    const group = new Set([...(window.office.group || []), me.id]);
    return [...document.querySelectorAll(".floater")].filter((node) => !node.hidden && group.has(node.dataset.id)).map((node) => {
      const box = node.getBoundingClientRect();
      return { id: node.dataset.id, top: box.top, feet: box.bottom + body, limit: top, bar };
    });
  });
  for (const tag of landTags) {
    assert(tag.top >= tag.limit - 2, `橫向名字被頂部列蓋住 ${JSON.stringify(tag)}`);
    assert(tag.feet < tag.bar - 2, `橫向角色被聊天框擋住 ${JSON.stringify(tag)}`);
  }
  await shot(yuki, "phone-office-landscape-chat");
  await yuki.getByRole("button", { name: "離開悄悄話" }).click();
  await yuki.waitForFunction(() => !window.office.whisper);
  if ((await yuki.locator("#chat-toggle").textContent()) === "收起") await yuki.locator("#chat-toggle").click();
  await yuki.locator("#chatbar").waitFor({ state: "hidden" });
  await settleView(yuki);
  await shot(yuki, "phone-office-landscape");
  const landBarHeight = await yuki.evaluate(() => document.querySelector("#topbar").getBoundingClientRect().height);
  assert(landBarHeight <= 64, `橫向頂部列換行了 ${landBarHeight}`);
  const landGap = await topbarGap(yuki);
  assert(landGap.gap >= 8 && landGap.hit === "view", `橫向頂部左右兩塊重疊或擋住場景 ${JSON.stringify(landGap)}`);
  await shot(yuki, "header-phone-landscape");

  await yuki.setViewportSize({ width: 1440, height: 900 });
  await yuki.waitForFunction(() => !window.office.phone);
  assert(await yuki.locator("#stick").isHidden(), "桌面不該出現搖桿");
  assert(await yuki.locator("#chat-input").isVisible(), "桌面的聊天框不該收起來");
  await yuki.setViewportSize({ width: 390, height: 844 });
  await yuki.locator("#people-btn").click();
  await yuki.locator("#rename").waitFor();
  const drawerButtons = await yuki.evaluate(() => {
    const drawer = document.querySelector("#online").getBoundingClientRect();
    return ["#clock-drawer", "#help-drawer", "#rename", "#pair-open"].map((sel) => {
      const node = document.querySelector(sel);
      const box = node.getBoundingClientRect();
      return {
        sel,
        w: box.width,
        h: box.height,
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        bg: getComputedStyle(node).backgroundColor,
        drawerTop: drawer.top,
        drawerBottom: drawer.bottom,
        drawerLeft: drawer.left,
        drawerRight: drawer.right,
      };
    });
  });
  for (const button of drawerButtons) {
    assert(button.h >= 44 && button.h <= 52, `抽屜按鈕尺寸不對 ${JSON.stringify(button)}`);
    assert(button.bottom <= button.drawerBottom + 1 && button.top >= button.drawerTop - 1, `抽屜按鈕被裁掉 ${JSON.stringify(button)}`);
    assert(Math.abs(button.w - drawerButtons[0].w) <= 2, `抽屜按鈕寬度不一致 ${JSON.stringify(drawerButtons)}`);
    assert(button.bg === drawerButtons[0].bg, `抽屜按鈕樣式不一致 ${JSON.stringify(drawerButtons)}`);
  }
  await shot(yuki, "header-phone-drawer");
  await shot(yuki, "style-buttons-phone");
  await yuki.locator("#help-drawer").click();
  await yuki.locator("#help").waitFor({ state: "visible" });
  const menuAfterHelp = await yuki.evaluate(() => ({
    open: document.body.classList.contains("people-open"),
    help: document.querySelector("#help").hidden,
  }));
  assert(!menuAfterHelp.open && menuAfterHelp.help === false, `操作後選單應關上且說明打開 ${JSON.stringify(menuAfterHelp)}`);
  await yuki.locator("#help-close").click();
  await yuki.locator("#help").waitFor({ state: "hidden" });
  await yuki.locator("#people-btn").click();
  await yuki.keyboard.press("Escape");
  assert(!(await yuki.evaluate(() => document.body.classList.contains("people-open"))), "Escape 應關上選單");
  await yuki.locator("#people-btn").click();
  await yuki.locator("#view").click({ position: { x: 40, y: 200 } });
  assert(!(await yuki.evaluate(() => document.body.classList.contains("people-open"))), "點外面應關上選單");
  await yuki.locator("#people-btn").click();
  assert(await yuki.evaluate(() => document.body.classList.contains("people-open")), "轉向前選單應該是開的");
  await yuki.setViewportSize({ width: 844, height: 390 });
  // 瀏覽器在下一次繪製前才送出 resize，改完尺寸不能馬上檢查。
  await yuki.waitForFunction(() => !document.body.classList.contains("people-open"), null, { timeout: 5000 }).catch(async () => {
    const diag = await yuki.evaluate(() => ({ w: innerWidth, h: innerHeight, open: document.body.classList.contains("people-open") }));
    assert(false, `轉向應關上選單 ${JSON.stringify(diag)}`);
  });
  await yuki.setViewportSize({ width: 390, height: 844 });
  await yuki.locator("#stick").waitFor();

  await march(yuki, 240, 560);
  await yuki.evaluate(() => window.office.setView({ yaw: Math.PI / 2 }));
  await yuki.waitForTimeout(900);
  if ((await yuki.evaluate(() => window.office.cameraMode)) !== "follow") await yuki.locator("#cam-btn").click();
  await yuki.waitForFunction(() => window.office.cameraMode === "follow");
  await settleView(yuki);
  await yuki.evaluate(() => window.office.beginCapture());
  await holdPointer(yuki, "#stick", 8, -52);
  await yuki.waitForFunction(() => window.office.captureCount() >= 12, null, { timeout: 5000 }).catch(async () => {
    const diag = await yuki.evaluate(() => ({ n: window.office.captureCount(), hidden: document.hidden, mode: window.office.cameraMode }));
    if (diag.n < 8) assert(false, `跟隨取樣沒有持續 ${JSON.stringify(diag)}`);
  });
  const followFrames = await yuki.evaluate(() => window.office.endCapture());
  await releasePointer(yuki);
  const followMove = followFrames.filter((row) => row.mode === "follow");
  assert(followMove.length > 8, `跟隨樣本太少 ${followMove.length}`);
  const culled = followMove.filter((row) => row.onScreen && (row.rigMiss > 0 || row.bodyIn === false || row.sphereMiss > 0));
  assert(culled.length === 0, `走路時角色網格被剔除 ${culled.length}`);
  const stepping = followMove.filter((row, index) => index > 0 && (row.x !== followMove[index - 1].x || row.z !== followMove[index - 1].z));
  assert(stepping.length > 4 && stepping.every((row) => row.sy <= 1.002), `走路姿勢不該在送出位置時被清掉 ${stepping.map((row) => row.sy).join(",")}`);
  let path = 0;
  let turn = 0;
  let camTurn = 0;
  for (let i = 1; i < followMove.length; i++) {
    path += Math.hypot(followMove[i].x - followMove[i - 1].x, followMove[i].z - followMove[i - 1].z);
    turn += Math.abs(Math.atan2(Math.sin(followMove[i].face - followMove[i - 1].face), Math.cos(followMove[i].face - followMove[i - 1].face)));
    camTurn += Math.abs(Math.atan2(Math.sin(followMove[i].heading - followMove[i - 1].heading), Math.cos(followMove[i].heading - followMove[i - 1].heading)));
  }
  const net = Math.hypot(followMove.at(-1).x - followMove[0].x, followMove.at(-1).z - followMove[0].z);
  assert(path > 40 && net / path > 0.8, `跟隨往前走不該打轉 path=${Math.round(path)} net=${Math.round(net)} turn=${turn.toFixed(2)}`);
  assert(camTurn < 0.45, `跟隨鏡頭不該跟著人一直轉 ${camTurn.toFixed(2)}`);
  await shot(yuki, "phone-follow-portrait");
  if ((await yuki.evaluate(() => window.office.cameraMode)) === "follow") await yuki.locator("#cam-btn").click();
  await march(yuki, 240, 560);
  await yuki.evaluate(() => window.office.setView({ yaw: Math.PI / 2 }));
  await yuki.waitForTimeout(900);
  if ((await yuki.evaluate(() => window.office.cameraMode)) !== "follow") await yuki.locator("#cam-btn").click();
  await yuki.waitForFunction(() => window.office.cameraMode === "follow");
  await yuki.keyboard.down("w");
  const keyStart = await yuki.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  await yuki.waitForFunction((start) => {
    const me = window.office.me;
    return Math.hypot(me.x - start.x, me.y - start.y) > 30;
  }, keyStart, { timeout: 4000 }).catch(async (error) => {
    const keyEnd = await yuki.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
    throw new Error(`鍵盤往前沒有走 ${JSON.stringify({ keyStart, keyEnd })}`, { cause: error });
  });
  await yuki.keyboard.up("w");

  await yuki.setViewportSize({ width: 390, height: 844 });
  await editFurniture(yuki, { touch: true, witness: kuma, shotName: "edit-phone", leave: true });

  if (!(await yuki.evaluate(() => document.body.classList.contains("people-open")))) await yuki.locator("#people-btn").click();
  await yuki.locator("#clock-drawer").click();
  await yuki.getByRole("heading", { name: "要下班了嗎？" }).waitFor();
  const covered = await yuki.evaluate(() => {
    const rename = document.querySelector("#rename").getBoundingClientRect();
    const card = document.querySelector("#clockout .card").getBoundingClientRect();
    const overlap = rename.bottom > card.top + 1 && rename.top < card.bottom && rename.right > card.left && rename.left < card.right;
    return { overlap, renameBottom: rename.bottom, cardTop: card.top };
  });
  assert(!covered.overlap, `下班對話框蓋住改名稱 ${JSON.stringify(covered)}`);
  await shot(yuki, "phone-clock-out");
  await yuki.getByRole("button", { name: "確定" }).click();
  await yuki.getByText("辛苦了，明天見！").waitFor();
  const after = await yuki.evaluate(async () => {
    const response = await fetch("/api/office/me");
    return { status: response.status, cookie: document.cookie.includes("office_session") };
  });
  assert(after.status === 401, `下班後應該是 401，實際 ${after.status}`);
  assert(after.cookie === false, "網頁不該讀得到登入 cookie");
  const left = (await iphone.cookies()).find((cookie) => cookie.name === "office_session");
  assert(!left?.value, "下班應該清掉 cookie");
  await kuma.waitForFunction(() => !window.office.others.some((person) => person.id === "yuki"));

  await rin.close();
  await rinContext.close();
  await kuma.close();
  await android.close();
  await yuki.close();
  await iphone.close();
}

async function pairSecondDevice(browser, host, admin) {
  await host.locator("#pair-open").click();
  await host.waitForFunction(() => /\d{3}\s\d{3}/.test(document.querySelector("#pair-code")?.textContent || ""));
  await shot(host, "pair-code-desktop");
  const desktop = host.viewportSize() || { width: 1440, height: 900 };
  await host.setViewportSize({ width: 390, height: 844 });
  await host.waitForTimeout(300);
  await shot(host, "pair-code-phone");
  await host.setViewportSize(desktop);
  const code = ((await host.locator("#pair-code").textContent()) || "").replace(/\D/g, "");
  assert(/^\d{6}$/.test(code), `代碼不對 ${code}`);
  const before = await host.evaluate(() => ({
    id: window.office.me.id,
    animal: window.office.me.animal,
    look: window.office.me.look,
    x: window.office.me.x,
    y: window.office.me.y,
  }));
  const otherContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const other = await otherContext.newPage();
  await other.goto(`${ORIGIN}/`);
  await other.getByLabel("辦公室密碼").fill(PASS);
  await other.getByRole("button", { name: "進入", exact: true }).click();
  await other.getByRole("button", { name: "我已經有 ID" }).click();
  await other.locator("#form-pair").waitFor();
  await shot(other, "pair-form-desktop");
  await other.setViewportSize({ width: 390, height: 844 });
  await other.waitForTimeout(300);
  await shot(other, "pair-form-phone");
  await other.setViewportSize({ width: 1280, height: 800 });
  await other.locator("#pair-id").fill(before.id);
  await other.locator("#pair-code-input").fill(code);
  await other.getByRole("button", { name: "加入這台裝置" }).click();
  await ready(other);
  const joined = await other.evaluate(() => ({
    id: window.office.me.id,
    animal: window.office.me.animal,
    look: window.office.me.look,
    x: window.office.me.x,
    y: window.office.me.y,
  }));
  assert(joined.id === before.id, "加入後 ID 不對");
  assert(joined.animal === before.animal, "加入後造型不對");
  assert(JSON.stringify(joined.look) === JSON.stringify(before.look), "加入後外觀不對");
  assert(Math.hypot(joined.x - before.x, joined.y - before.y) < 240, `加入後位置差太多 ${JSON.stringify({ before, joined })}`);
  await host.getByRole("heading", { name: "已在其他裝置上線" }).waitFor();
  await host.waitForTimeout(1500);
  assert(await host.locator("#elsewhere").isVisible(), "不該自己搶回連線");
  assert((await other.evaluate(() => window.office.ready)) === true, "新裝置應該維持在線");
  await host.getByRole("button", { name: "取回控制" }).click();
  await ready(host);
  await other.getByRole("heading", { name: "已在其他裝置上線" }).waitFor();
  await admin.locator("#refresh").click();
  await admin.locator(`tr.devices[data-for="${before.id}"] .device`).nth(1).waitFor();
  await host.locator("#clock-btn").click();
  await host.getByRole("button", { name: "確定" }).click();
  await host.getByText("辛苦了，明天見！").waitFor();
  await other.locator("#gate-msg").getByText("已在其他裝置下班").waitFor();
  const hostMe = await host.evaluate(async () => (await fetch("/api/office/me")).status);
  const otherMe = await other.evaluate(async () => (await fetch("/api/office/me")).status);
  assert(hostMe === 401 && otherMe === 401, `下班後兩邊都應登出 ${hostMe} ${otherMe}`);
  await host.getByLabel("辦公室密碼").fill(PASS);
  await host.getByRole("button", { name: "進入", exact: true }).click();
  await ready(host);
  assert((await host.evaluate(() => window.office.me.id)) === before.id, "下班後應該用原 ID 回來");
  await other.close();
  await otherContext.close();
}

async function migrateLegacy(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await register(page, "sora", "空", "狐");
  const session = (await context.cookies()).find((cookie) => cookie.name === "office_session");
  assert(session?.value, "遷移測試缺少 cookie");
  await context.clearCookies();
  await page.evaluate((token) => localStorage.setItem("office_session", token), session.value);
  await page.reload();
  await ready(page);
  assert((await page.evaluate(() => localStorage.getItem("office_session"))) === null, "舊權杖應該清掉");
  const again = (await context.cookies()).find((cookie) => cookie.name === "office_session");
  assert(again?.httpOnly === true && again.value, "舊權杖沒有換成 HttpOnly cookie");
  await page.close();
  await context.close();
}

function publishShots() {
  if (!ARTIFACTS || saved.length === 0) return;
  mkdirSync(ARTIFACTS, { recursive: true });
  for (const item of saved) cpSync(item.file, join(ARTIFACTS, `${item.name}.png`));
}

function stopChild(proc) {
  if (!proc?.pid) return;
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-proc.pid, signal);
    } catch {
      try {
        proc.kill(signal);
      } catch {
        /* already gone */
      }
    }
  }
}

function adminCookie(response) {
  const raw = response.headers.getSetCookie?.() || [];
  const line = raw.find((item) => item.startsWith("office_admin="));
  assert(line, "管理登入沒有留下 cookie");
  assert(/;\s*Path=\/api\/office\/admin(;|$)/i.test(line), `管理 cookie 範圍太大 ${line}`);
  return line.split(";")[0].slice("office_admin=".length);
}

async function adminSessions() {
  const headers = { "content-type": "application/json", origin: ORIGIN };
  const login = await fetch(`${ORIGIN}/api/office/admin/session`, {
    method: "POST",
    headers: { ...headers, authorization: `Bearer ${ADMIN}` },
    body: "{}",
  });
  assert(login.ok, `管理登入失敗 ${login.status}`);
  const secret = decodeURIComponent(adminCookie(login));
  assert(secret !== ADMIN, "瀏覽器不該拿到原本的管理密鑰");
  const authed = { ...headers, cookie: `office_admin=${encodeURIComponent(secret)}` };
  const overview = await fetch(`${ORIGIN}/api/office/admin/overview`, { headers: authed });
  assert(overview.ok, `管理頁應接受登入 ${overview.status}`);
  const script = await fetch(`${ORIGIN}/api/office/admin/health`, { headers: { authorization: `Bearer ${ADMIN}` } });
  assert(script.ok, `腳本仍應可用 ${script.status}`);
  const logout = await fetch(`${ORIGIN}/api/office/admin/logout`, { method: "POST", headers: authed, body: "{}" });
  assert(logout.ok, `登出失敗 ${logout.status}`);
  const cleared = logout.headers.getSetCookie?.() || [];
  assert(cleared.some((item) => /Path=\/api\/office\/admin/i.test(item)) && cleared.some((item) => /Path=\/(;|$)/i.test(item)), `登出應清掉新舊管理 cookie ${cleared}`);
  const gone = await fetch(`${ORIGIN}/api/office/admin/overview`, { headers: authed });
  assert(gone.status === 401, `登出後應拒絕 ${gone.status}`);

  const again = await fetch(`${ORIGIN}/api/office/admin/session`, {
    method: "POST",
    headers: { ...headers, authorization: `Bearer ${ADMIN}` },
    body: "{}",
  });
  const second = decodeURIComponent(adminCookie(again));
  const secondHeaders = { ...headers, cookie: `office_admin=${encodeURIComponent(second)}` };
  const changed = await fetch(`${ORIGIN}/api/office/admin/password`, {
    method: "POST",
    headers: { ...headers, authorization: `Bearer ${ADMIN}` },
    body: JSON.stringify({ password: PASS }),
  });
  assert(changed.ok, `換辦公室密碼失敗 ${changed.status}`);
  const afterPassword = await fetch(`${ORIGIN}/api/office/admin/overview`, { headers: secondHeaders });
  assert(afterPassword.status === 401, `換密碼後舊的管理登入應失效 ${afterPassword.status}`);

  const thirdLogin = await fetch(`${ORIGIN}/api/office/admin/session`, {
    method: "POST",
    headers: { ...headers, authorization: `Bearer ${ADMIN}` },
    body: "{}",
  });
  const third = decodeURIComponent(adminCookie(thirdLogin));
  const thirdHeaders = { ...headers, cookie: `office_admin=${encodeURIComponent(third)}` };
  const revoked = await fetch(`${ORIGIN}/api/office/admin/sessions/revoke`, { method: "POST", headers: thirdHeaders, body: "{}" });
  assert(revoked.ok, `登出所有管理登入失敗 ${revoked.status}`);
  const afterRevoke = await fetch(`${ORIGIN}/api/office/admin/overview`, { headers: thirdHeaders });
  assert(afterRevoke.status === 401, `全部登出後應拒絕 ${afterRevoke.status}`);
  const still = await fetch(`${ORIGIN}/api/office/admin/health`, { headers: { authorization: `Bearer ${ADMIN}` } });
  assert(still.ok, `管理密鑰本身應還能用 ${still.status}`);
}

async function removedDeviceCanRegister(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await register(page, "momo", "桃", "貓");
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const admin = await adminContext.newPage();
  admin.on("dialog", (dialog) => dialog.accept());
  await admin.goto(`${ORIGIN}${PANEL}/`);
  await admin.getByLabel("密碼", { exact: true }).fill(ADMIN);
  await admin.getByRole("button", { name: "進入" }).click();
  await admin.locator('tr.devices[data-for="momo"]').getByRole("button", { name: "移除裝置" }).click();
  await admin.getByText("還沒有加入的裝置").waitFor();
  await page.getByText("這台裝置已移除").waitFor();
  await page.getByLabel("辦公室密碼").fill(PASS);
  await page.getByRole("button", { name: "進入", exact: true }).click();
  await page.locator("#form-register").waitFor();
  await page.locator("#office-id").fill("mika");
  await page.locator("#office-name").fill("米卡");
  const registered = page.waitForResponse((res) => res.url().includes("/api/office/register") && res.request().method() === "POST");
  await page.locator("#form-register").getByRole("button", { name: "下一步" }).click();
  const response = await registered;
  assert(response.ok(), `移除裝置後應該可以登記，實際 ${response.status()}`);
  await page.getByRole("button", { name: "貓", exact: true }).click();
  await page.getByRole("button", { name: "進入辦公室" }).click();
  await ready(page);
  assert((await page.evaluate(() => window.office.me.id)) === "mika", "新 ID 沒有登記成功");
  await admin.close();
  await adminContext.close();
  await page.close();
  await context.close();
}

async function chatModeAndCamera(browser) {
  const setPassword = await fetch(`${ORIGIN}/api/office/admin/password`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, origin: ORIGIN },
    body: JSON.stringify({ password: PASS }),
  });
  assert(setPassword.ok, `聊天測試沒設好密碼 ${setPassword.status}`);
  const talkContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const talk = await talkContext.newPage();
  await register(talk, "tess", "泰絲", "貓");
  const seeContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const see = await seeContext.newPage();
  await register(see, "gale", "蓋爾", "貓");
  await talk.waitForFunction(() => window.office.others.some((person) => person.id === "gale"));
  await see.waitForFunction(() => window.office.others.some((person) => person.id === "tess"));

  const input = talk.locator("#chat-input");
  const typing = () => talk.evaluate(() => document.activeElement === document.querySelector("#chat-input"));
  const spot = () => talk.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  await talk.evaluate(() => document.activeElement?.blur?.());
  assert((await input.getAttribute("placeholder"))?.includes("按 T"), "行走時輸入框要提示按 T");
  await talk.keyboard.press("t");
  assert(await typing(), "按 T 應該進入輸入框");
  assert((await input.inputValue()) === "", "進入對話的 T 不該打進輸入框");
  assert((await input.getAttribute("placeholder"))?.includes("Esc"), "對話時要提示 Esc 回到行走");
  await talk.keyboard.type("tea time");
  await talk.keyboard.press("Enter");
  await see.waitForFunction(() => window.office.bubbles.some((bubble) => bubble.id === "tess" && bubble.text === "tea time"));
  assert(await typing(), "送出後應該留在對話模式");
  assert((await input.inputValue()) === "", "送出後輸入框要清空");
  const parked = await spot();
  await talk.keyboard.down("ArrowRight");
  await talk.waitForTimeout(350);
  await talk.keyboard.up("ArrowRight");
  const stay = await spot();
  assert(Math.hypot(stay.x - parked.x, stay.y - parked.y) < 1, "對話模式按方向鍵不該走動");
  await talk.keyboard.type("draft");
  await input.evaluate((node) => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true })));
  assert(await typing(), "選字中的 Esc 不該離開對話");
  await input.evaluate((node) => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
  assert(await typing(), "選字中的 Enter 不該離開對話");
  await talk.keyboard.press("Escape");
  assert(!(await typing()), "Esc 應該回到行走");
  assert((await input.inputValue()) === "draft", "回到行走要保留沒送出的字");
  const from = await spot();
  await talk.keyboard.down("ArrowRight");
  await talk.waitForFunction((from) => Math.hypot(window.office.me.x - from.x, window.office.me.y - from.y) > 12, from, { timeout: 5000 }).catch(async (error) => {
    const seen = await talk.evaluate(() => ({ me: window.office.me, others: window.office.others.map((p) => [p.id, p.x, p.y]), connected: window.office.connected, hidden: document.hidden, active: document.activeElement?.id, cam: window.office.cameraMode }));
    throw new Error(`離開對話後按右鍵沒有走動 ${JSON.stringify({ from, seen })}`, { cause: error });
  });
  await talk.keyboard.up("ArrowRight");
  await talk.keyboard.press("t");
  assert(await typing(), "再按 T 應該回到輸入框");
  assert((await input.inputValue()) === "draft", "回到輸入框時不該多打 t");
  await input.fill("");
  await talk.keyboard.press("t");
  assert((await input.inputValue()) === "t", "對話模式按 T 要打出字");
  await input.fill("");
  await talk.keyboard.press("Enter");
  assert(!(await typing()), "空白時按 Enter 應該回到行走");

  await settleView(talk);
  await dragCamera(talk, see, "tess");
  const walkSpot = await openSpots(talk, 160);
  const beforeClick = await spot();
  await talk.mouse.click(walkSpot.left, walkSpot.y);
  await talk.waitForFunction((from) => Math.hypot(window.office.me.x - from.x, window.office.me.y - from.y) > 12, beforeClick, { timeout: 5000 });

  await see.close();
  await seeContext.close();
  await talk.close();
  await talkContext.close();
}

async function seenNear(page, id, kind) {
  try {
    await page.waitForFunction(({ id, kind }) => {
      const person = window.office.others.find((item) => item.id === id);
      const spot = window.office.snackSpot(kind);
      if (!person || !spot) return false;
      const x = person.tx ?? person.x;
      const y = person.ty ?? person.y;
      return Math.hypot(x - spot.x, y - spot.y) < 108 && Math.hypot(person.x - spot.x, person.y - spot.y) < 108;
    }, { id, kind }, { timeout: 20000 });
  } catch (error) {
    const where = await page.evaluate(({ id, kind }) => {
      const person = window.office.others.find((item) => item.id === id);
      return { person, spot: window.office.snackSpot(kind) };
    }, { id, kind });
    throw new Error(`${id} 沒有靠近${kind} ${JSON.stringify(where)}`, { cause: error });
  }
}

async function snackShot(page, name) {
  const dir = process.env.SNACK_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

async function takeSnack(page, item) {
  const before = await page.evaluate((id) => window.office.snackStock[id], item);
  // The cabinet and the vendor stand side by side and walkTo() returns while still walking,
  // so wait until this machine is the nearer one before opening its menu.
  const kind = ["tea", "soda", "juice", "latte"].includes(item) ? "vendor" : "snackcab";
  const title = kind === "vendor" ? "販賣機" : "零食櫃";
  await page.waitForFunction(({ kind }) => {
    const me = window.office.me;
    const mine = window.office.snackSpot(kind);
    const other = window.office.snackSpot(kind === "vendor" ? "snackcab" : "vendor");
    return me && mine && other && Math.hypot(me.x - mine.x, me.y - mine.y) + 8 < Math.hypot(me.x - other.x, me.y - other.y);
  }, { kind }, { timeout: 15000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const open = await page.locator("#snack-menu").isVisible();
    if (open && (await page.locator("#snack-title").textContent()) !== title) await page.locator("#snack-close").click();
    if (!(await page.locator("#snack-menu").isVisible())) {
      await page.evaluate(() => window.office.snackMenu());
      await page.locator("#snack-menu").waitFor();
    }
    await page.locator(`#snack-menu button[data-item="${item}"]`).click({ timeout: 8000 }).catch(async (error) => {
      const where = await page.evaluate(() => ({
        me: window.office.me,
        title: document.querySelector("#snack-title")?.textContent,
        open: window.office.snackOpen,
        hint: document.querySelector("#hint")?.textContent,
      }));
      throw new Error(`點心選單沒有 ${item} ${JSON.stringify(where)}`, { cause: error });
    });
    try {
      await page.waitForFunction(({ id, before }) => window.office.snackStock[id] === before - 1, { id: item, before }, { timeout: 1500 });
      return before - 1;
    } catch {
      await page.waitForTimeout(400);
    }
  }
  throw new Error(`沒有拿到 ${item}`);
}

async function snackLounge(browser) {
  const setPassword = await fetch(`${ORIGIN}/api/office/admin/password`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, origin: ORIGIN },
    body: JSON.stringify({ password: PASS }),
  });
  assert(setPassword.ok, `零食測試沒設好密碼 ${setPassword.status}`);
  const biteContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const sipContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const bite = await biteContext.newPage();
  const sip = await sipContext.newPage();
  await register(bite, "bite", "點心", "貓");
  await register(sip, "sip", "飲料", "兔");
  await bite.waitForFunction(() => window.office.others.some((person) => person.id === "sip"));
  await sip.waitForFunction(() => window.office.snackStock.cookie === 5 && window.office.snackStock.tea === 5);
  await assetsReady(bite);
  const cabinet = await bite.evaluate(() => window.office.snackSpot("snackcab"));
  const vendor = await bite.evaluate(() => window.office.snackSpot("vendor"));
  assert(cabinet && vendor, "沙發區沒有零食櫃或販賣機");
  await walkTo(bite, 34 * 32 + 16, 26 * 32 + 16);
  await walkTo(bite, 32 * 32 + 16, 26 * 32 + 16);
  await walkTo(bite, 32 * 32 + 16, 30 * 32 + 16);
  await bite.evaluate(() => window.office.setView({ dist: 460, pitch: 0.7, yaw: Math.PI }));
  await bite.waitForTimeout(700);
  await snackShot(bite, "sofa-snacks-desktop");
  await walkTo(bite, cabinet.standX, cabinet.standY);
  await seenNear(sip, "bite", "snackcab");
  await bite.keyboard.press("e");
  await bite.locator("#snack-menu").waitFor();
  await bite.locator('#snack-menu button[data-item="cookie"]').waitFor();
  assert((await bite.locator('#snack-menu button[data-item="cookie"]').innerText()).includes("剩 5"), "餅乾一開始應該有 5 份");
  await snackShot(bite, "snack-picker-desktop");
  await bite.locator("#snack-close").click();
  await bite.setViewportSize({ width: 390, height: 844 });
  await bite.waitForTimeout(400);
  await bite.getByRole("button", { name: "拿零食" }).click();
  await bite.locator("#snack-menu").waitFor();
  const phoneBox = await bite.locator("#snack-menu").boundingBox();
  assert(phoneBox && phoneBox.width < 390 && phoneBox.x >= 0 && phoneBox.y >= 0, "手機上的點心選單超出畫面");
  await snackShot(bite, "snack-picker-phone");
  await bite.setViewportSize({ width: 1280, height: 800 });
  await bite.waitForTimeout(300);
  const afterCookie = await takeSnack(bite, "cookie");
  assert(afterCookie === 4, `點心拿完應該剩 4，實際 ${afterCookie}`);
  await sip.waitForFunction(() => window.office.snackStock.cookie === 4);
  await bite.waitForFunction(() => window.office.snackCarry === "cookie" && window.office.snackPhase() < 0);
  await sip.waitForFunction(() => window.office.snackCarryOf("bite") === "cookie");
  await bite.evaluate(() => window.office.setView({ dist: 230, pitch: 1.0, yaw: -0.15 }));
  await bite.waitForTimeout(500);
  await snackShot(bite, "holding-snack");
  await bite.evaluate(() => window.office.snackHold(0.55));
  await bite.setViewportSize({ width: 390, height: 844 });
  await bite.getByRole("button", { name: "吃點心" }).click();
  await bite.waitForFunction(() => window.office.snackPhase() >= 0.5);
  await bite.setViewportSize({ width: 1280, height: 800 });
  await bite.evaluate(() => window.office.setView({ dist: 230, pitch: 1.0, yaw: -0.15 }));
  await bite.waitForTimeout(400);
  await snackShot(bite, "avatar-eating");
  await bite.evaluate(() => window.office.snackHold(null));
  await bite.waitForFunction(() => window.office.snackPhase() < 0 && window.office.snackCarry === "");
  await walkTo(bite, vendor.standX, vendor.standY);
  await bite.waitForFunction(() => {
    const me = window.office.me;
    const vend = window.office.snackSpot("vendor");
    const cab = window.office.snackSpot("snackcab");
    return Math.hypot(me.x - vend.x, me.y - vend.y) + 12 < Math.hypot(me.x - cab.x, me.y - cab.y);
  }, null, { timeout: 10000 });
  await seenNear(sip, "bite", "vendor");
  const afterTea = await takeSnack(bite, "tea");
  assert(afterTea === 4, `綠茶拿完應該剩 4，實際 ${afterTea}`);
  await sip.waitForFunction(() => window.office.snackStock.tea === 4 && window.office.snackStock.cookie === 4);
  await bite.waitForFunction(() => window.office.snackCarry === "tea" && window.office.snackPhase() < 0);
  await sip.waitForFunction(() => window.office.snackCarryOf("bite") === "tea");
  // Someone who left while this tab was offline must not keep a snack after the reconnect.
  await sip.evaluate(() => window.office.feed({ t: "snacks", hold: { id: "ghost", item: "cookie", pose: "eat", replaced: false } }));
  assert((await sip.evaluate(() => window.office.snackCarryOf("ghost"))) === "cookie", "測試用的殘留手持沒有放上去");
  const oldSocket = await sip.evaluate(() => {
    window.__oldSocket = window.office.socket;
    window.office.socket.close();
    return true;
  });
  assert(oldSocket, "沒有關掉連線");
  await sip.waitForFunction(() => window.office.connected && window.office.socket !== window.__oldSocket, null, { timeout: 15000 });
  await sip.waitForFunction(() => window.office.snackCarryOf("ghost") === "" && window.office.snackCarryOf("bite") === "tea");
  await bite.waitForTimeout(400);
  await snackShot(bite, "holding-drink");
  await bite.evaluate(() => window.office.snackHold(0.55));
  await bite.keyboard.press("e");
  await bite.waitForFunction(() => window.office.snackPhase() >= 0.5);
  await bite.waitForTimeout(300);
  await snackShot(bite, "avatar-drinking");
  await bite.evaluate(() => window.office.snackHold(null));
  await bite.waitForFunction(() => window.office.snackPhase() < 0 && window.office.snackCarry === "");
  await walkTo(bite, cabinet.standX, cabinet.standY);
  await seenNear(sip, "bite", "snackcab");
  let left = await bite.evaluate(() => window.office.snackStock.cookie);
  while (left > 0) {
    left = await takeSnack(bite, "cookie");
  }
  await sip.waitForFunction(() => window.office.snackStock.cookie === 0);
  if (!(await bite.locator("#snack-menu").isVisible())) await bite.evaluate(() => window.office.snackMenu());
  await bite.locator("#snack-menu").waitFor();
  const sold = bite.locator('#snack-menu button[data-item="cookie"]');
  assert(await sold.isDisabled(), "沒了的餅乾還能按");
  const soldText = await sold.innerText();
  assert(soldText.includes("已售完") && soldText.includes("沒了"), `售完文字不對 ${soldText}`);
  await snackShot(bite, "snack-sold-out");
  await bite.keyboard.press("Escape");
  await walkTo(bite, 32 * 32 + 16, 30 * 32 + 16);
  await walkTo(bite, 32 * 32 + 16, 26 * 32 + 16);
  await walkTo(bite, 34 * 32 + 16, 25 * 32 + 16);
  // 到了櫃檯前還可能被伺服器拉回；不在 Lala 附近就重走。
  for (let attempt = 1; ; attempt++) {
    await walkTo(bite, 224, 208);
    const near = await bite.waitForFunction(() => {
      const me = window.office.me;
      return Math.hypot(me.x - 224, me.y - 116) < 112;
    }, null, { timeout: 5000 }).then(() => true, () => false);
    if (near) break;
    if (attempt === 3) {
      const me = await bite.evaluate(() => window.office.me);
      throw new Error(`走不到 Lala 面前（${Math.round(me.x)},${Math.round(me.y)}）`);
    }
  }
  await sip.waitForFunction(() => {
    const person = window.office.others.find((item) => item.id === "bite");
    const x = person?.tx ?? person?.x;
    const y = person?.ty ?? person?.y;
    return person && Math.hypot(x - 224, y - 116) < 120 && Math.hypot(person.x - 224, person.y - 116) < 120;
  });
  await bite.keyboard.press("e");
  await bite.getByRole("button", { name: "零食/飲料沒了，麻煩補貨" }).waitFor();
  await bite.evaluate(() => window.office.setView({ dist: 340, pitch: 0.95, yaw: -0.4 }));
  await bite.waitForTimeout(400);
  await snackShot(bite, "lala-restock");
  await bite.getByRole("button", { name: "零食/飲料沒了，麻煩補貨" }).click();
  await bite.locator("#dialogue-text", { hasText: "好的，馬上幫你補上！" }).waitFor();
  await sip.waitForFunction(() => window.office.snackStock.cookie === 5 && window.office.snackStock.tea === 4 && window.office.snackStock.juice === 5);
  await bite.keyboard.press("Escape");
  await bite.keyboard.press("e");
  await bite.getByText("零食和飲料都還有喔。").waitFor();
  assert(await bite.getByRole("button", { name: "零食/飲料沒了，麻煩補貨" }).count() === 0 || await bite.locator("#btn-restock").isHidden(), "還有庫存時不該再請補貨");
  await sip.close();
  await bite.close();
  await sipContext.close();
  await biteContext.close();
}


// Fires the real interact key inside the page as soon as the catch window opens,
// so a slow runner does not miss it between separate evaluate() round trips.
function armCatch(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      if (window.office.toys.catchable) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "e" }));
        resolve(true);
      } else if (performance.now() - started > 20000) resolve(false);
      else requestAnimationFrame(tick);
    };
    tick();
  }));
}

async function pressE(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "e" }));
  });
}

// The ball has a short per-player cooldown, so keep pressing until it actually leaves the hand.
async function throwBall(page) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    await pressE(page);
    const gone = await page.waitForFunction(() => window.office.toyHeld !== "ball", null, { timeout: 1000 }).then(() => true, () => false);
    if (gone) return;
  }
  throw new Error("球一直丟不出去");
}

async function takeToy(page, toy) {
  if (!(await page.locator("#toy-menu").isVisible())) {
    // Empty hands open the rack with the key; holding a toy next to a coworker the key uses the toy,
    // so the rack is opened the way a click on it does.
    if (await page.evaluate(() => window.office.toyHeld)) await page.evaluate(() => window.office.toyMenu());
    else await pressE(page);
    await page.locator("#toy-menu").waitFor();
  }
  await page.locator(`#toy-menu button[data-toy="${toy}"]:not([disabled])`).click();
  await page.waitForFunction((toy) => window.office.toyHeld === toy, toy);
  // Taking a toy closes the rack menu; the next press of the key uses the toy.
  await page.locator("#toy-menu").waitFor({ state: "hidden" });
}

async function toyRoom(browser) {
  const setPassword = await fetch(`${ORIGIN}/api/office/admin/password`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, origin: ORIGIN },
    body: JSON.stringify({ password: PASS }),
  });
  assert(setPassword.ok, `玩具測試沒設好密碼 ${setPassword.status}`);
  const pitchContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const mittContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pitch = await pitchContext.newPage();
  const mitt = await mittContext.newPage();
  try {
    await register(pitch, "pitch", "投手", "貓");
    await register(mitt, "mitt", "捕手", "兔");
    await pitch.waitForFunction(() => window.office.others.some((person) => person.id === "mitt"));
    await mitt.waitForFunction(() => window.office.others.some((person) => person.id === "pitch"));
    await assetsReady(pitch);
    const rack = await pitch.evaluate(() => window.office.toyRack);
    assert(rack, "遊戲室沒有玩具架");
    // 遊戲室 covers tiles 28–38 by 1–8.
    assert(rack.x > 28 * 32 && rack.x < 39 * 32 && rack.y > 32 && rack.y < 9 * 32, `玩具架應該在遊戲室，實際 ${JSON.stringify(rack)}`);
    await pitch.waitForFunction(() => {
      const toys = window.office.toys.toys;
      return ["hammer", "ball", "plane", "pillow", "pinch", "ram"].every((id) => toys[id]?.at === "rack")
        && window.office.toys.placed.length === 6;
    });
    await walkTo(pitch, rack.standX, rack.standY);
    await march(pitch, rack.standX, rack.standY);
    await walkTo(mitt, rack.standX, rack.standY + 70);
    await march(mitt, rack.standX, rack.standY + 70);
    await pitch.waitForFunction(({ x, y }) => Math.hypot(window.office.me.x - x, window.office.me.y - y) < 100, rack);
    // Both stand still and in hammer reach before anything is swung.
    await pitch.waitForFunction(() => {
      const me = window.office.me;
      const other = window.office.others.find((person) => person.id === "mitt");
      return other && Math.hypot(me.x - other.x, me.y - other.y) < 96 && Math.hypot(other.x - (other.tx ?? other.x), other.y - (other.ty ?? other.y)) < 1;
    }, null, { timeout: 20000 }).catch(async (error) => {
      const where = await pitch.evaluate(() => ({ me: window.office.me, others: window.office.others }));
      throw new Error(`兩人沒有站在錘子打得到的距離 ${JSON.stringify(where)}`, { cause: error });
    });

    // Hammer: taking it only puts it in the hand; the interact key then bonks.
    await takeToy(pitch, "hammer");
    await mitt.waitForFunction(() => window.office.toyHeldOf("pitch") === "hammer" && window.office.toyProp("pitch") === "hammer");
    await pressE(pitch);
    // The lowest squash a frame drew is kept, so a slow runner that skips frames still sees it.
    await mitt.waitForFunction(() => {
      const scale = window.office.toySquash("mitt");
      return scale && scale.low < 0.8;
    }, null, { timeout: 15000 });
    await mitt.waitForFunction(() => window.office.toyFx().some((fx) => fx.kind === "bonk" && fx.by === "pitch" && fx.to === "mitt"));
    await pitch.waitForFunction(() => window.office.toyFx().some((fx) => fx.kind === "bonk" && fx.to === "mitt"));
    // The squash springs back instead of staying flat.
    await mitt.waitForFunction(() => {
      const scale = window.office.toySquash("mitt");
      return scale && !scale.busy && Math.abs(scale.y - 1) < 0.08;
    }, null, { timeout: 15000 });

    // Ball: swapping at the rack puts the hammer back.
    await takeToy(pitch, "ball");
    await pitch.waitForFunction(() => window.office.toys.toys.hammer.at === "rack");
    let caught = armCatch(mitt);
    await throwBall(pitch);
    assert(await caught, "捕手沒看到可以接球");
    await mitt.waitForFunction(() => window.office.toyHeld === "ball");
    await pitch.waitForFunction(() => window.office.toyHeldOf("mitt") === "ball" && window.office.toys.combo === 1);
    caught = armCatch(pitch);
    await throwBall(mitt);
    assert(await caught, "投手沒看到可以接球");
    await pitch.waitForFunction(() => window.office.toyHeld === "ball" && window.office.toys.combo === 2);
    await mitt.waitForFunction(() => window.office.toyFx().some((fx) => fx.kind === "catch" && fx.by === "pitch" && fx.combo === 2));
    await mitt.waitForFunction(() => window.office.bubbles.some((bubble) => bubble.id === "pitch" && bubble.text.includes("連續 2")));

    // Nobody presses the key: the ball drops, rolls, the combo resets, and it can be picked up.
    await throwBall(pitch);
    await mitt.waitForFunction(() => window.office.toys.toys.ball.at === "floor" && window.office.toys.combo === 0, null, { timeout: 15000 });
    await pitch.waitForFunction(() => window.office.toys.toys.ball.at === "floor");
    const ball = await mitt.evaluate(() => window.office.toys.toys.ball);
    const mittAt = await mitt.evaluate(() => window.office.me);
    assert(Math.hypot(ball.x - mittAt.x, ball.y - mittAt.y) < 60, `球應該掉在捕手腳邊 ${JSON.stringify({ ball, mittAt })}`);
    assert(!(await pitch.evaluate(() => window.office.blocked(window.office.toys.toys.ball.x, window.office.toys.toys.ball.y))), "球不該掉進牆或家具裡");
    await pressE(mitt);
    await mitt.waitForFunction(() => window.office.toyHeld === "ball");
    await pitch.waitForFunction(() => window.office.toyHeldOf("mitt") === "ball");

    // Paper plane: write, throw, and the coworker opens it. The text goes through the chat cleanup and limit.
    await takeToy(pitch, "plane");
    await pressE(pitch);
    await pitch.locator("#toy-compose").waitFor();
    const note = `<b>午餐</b>吃什麼？${"好".repeat(90)}`;
    await pitch.locator("#toy-text").fill(note);
    assert((await pitch.locator("#toy-text").inputValue()).length <= 80, "紙飛機輸入框應該限制 80 字");
    // Past the input limit on purpose: the server must cut it the same way it cuts chat.
    await pitch.locator("#toy-text").evaluate((node, text) => { node.value = text; }, note);
    await pitch.locator("#toy-send").click();
    await pitch.locator("#toy-compose").waitFor({ state: "hidden" });
    await mitt.waitForFunction(() => window.office.toyFx().some((fx) => fx.kind === "plane" && fx.by === "pitch"));
    await mitt.locator("#toy-letter").waitFor();
    assert((await pitch.evaluate(() => window.office.toys.letters.length)) === 0, "紙飛機的內容只該給收件的人");
    await mitt.locator("#toy-letter").click();
    await mitt.locator("#toy-read").waitFor();
    const letter = await mitt.evaluate(() => ({
      text: document.querySelector("#toy-read-text").textContent,
      from: document.querySelector("#toy-read-from").textContent,
      children: document.querySelector("#toy-read-text").children.length,
    }));
    assert(letter.children === 0, "紙飛機內容不該被當成 HTML");
    assert([...letter.text].length === 80 && letter.text.startsWith("<b>午餐</b>吃什麼？"), `紙飛機應沿用聊天的長度限制 ${JSON.stringify(letter)}`);
    assert(letter.from.includes("@pitch"), `紙飛機應寫出寄件人 ${JSON.stringify(letter)}`);
    await mitt.locator("#toy-read-close").click();
    await mitt.locator("#toy-read").waitFor({ state: "hidden" });

    // Pinch: holding the key stretches the cheeks; letting go snaps them back.
    await takeToy(pitch, "pinch");
    await pitch.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" })));
    await mitt.waitForFunction(() => window.office.toyFx().some((fx) => fx.kind === "pinch" && fx.by === "pitch" && fx.on === true));
    await pitch.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "e" })));
    await mitt.waitForFunction(() => window.office.toyFx().some((fx) => fx.kind === "pinch" && fx.by === "pitch" && fx.on === false));

    // Leaving puts a held toy back on the rack, the same way a held snack is let go.
    await pitch.close();
    await mitt.waitForFunction(() => window.office.toys.toys.pinch.at === "rack" && window.office.toyHeldOf("pitch") === "");
    console.log("toys ok");
  } catch (error) {
    const dump = async (page) => (page.isClosed() ? null : page.evaluate(() => ({
      me: window.office.me && { id: window.office.me.id, x: Math.round(window.office.me.x), y: Math.round(window.office.me.y) },
      toys: window.office.toys,
      fx: window.office.toyFx().map(({ at, ...fx }) => fx),
      bubbles: window.office.bubbles,
      hint: document.querySelector("#hint")?.textContent,
    })).catch(() => null));
    console.error("toy state", JSON.stringify({ pitch: await dump(pitch), mitt: await dump(mitt) }));
    throw error;
  } finally {
    await pitchContext.close();
    await mittContext.close();
  }
}

async function seatedCamera(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await register(page, "sena", "星奈", "貓");
  await settleView(page);
  const chair = await page.evaluate(() => {
    const list = window.office.furniture.filter((item) => item.kind === "chair" && !item.seat && item.id.startsWith("desk-"));
    const item = list[0];
    return item ? { id: item.id, x: item.x + 16, y: item.y + 13 } : null;
  });
  assert(chair, "找不到空椅子");
  await march(page, chair.x + 140, chair.y + 48);
  await march(page, chair.x, chair.y + 48);
  await page.waitForTimeout(250);
  await page.keyboard.press("e");
  let sat = null;
  for (let i = 0; i < 15; i++) {
    sat = await page.evaluate((id) => {
      const me = window.office.me;
      const item = window.office.furniture.find((entry) => entry.id === id);
      const dist = item ? Math.round(Math.hypot(me.x - item.x - 16, me.y - item.y - 13)) : null;
      return { seat: window.office.seat, dist, x: Math.round(me.x), y: Math.round(me.y), hint: document.querySelector("#hint")?.textContent || "" };
    }, chair.id);
    if (sat.seat === chair.id) break;
    await page.waitForTimeout(200);
  }
  assert(sat.seat === chair.id, `沒坐下 ${JSON.stringify(sat)} chair=${chair.id}`);
  const face = await page.evaluate(() => {
    const item = window.office.furniture.find((entry) => entry.id === window.office.seat);
    return ((Number(item?.rot) || 0) * Math.PI) / 180;
  });
  await seeHeading(page, "sena", face);
  const spot = await openSpots(page, 220);
  const before = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y, seat: window.office.seat }));
  const cam = await camHeading(page);
  await dragAim(page, { x: spot.left, y: spot.y }, { x: spot.left + 200, y: spot.y });
  const camTurned = await camHeading(page);
  assert(angleGap(cam, camTurned) > 0.5, `坐著左鍵拖曳應該轉鏡頭，差 ${angleGap(cam, camTurned).toFixed(2)}`);
  await seeHeading(page, "sena", face);
  const afterDrag = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y, seat: window.office.seat }));
  assert(afterDrag.seat === before.seat, "拖曳轉鏡頭不該起立");
  assert(Math.hypot(afterDrag.x - before.x, afterDrag.y - before.y) < 2, "拖曳轉鏡頭不該離開椅子");
  await tiltCheck(page, spot, "坐著");
  const dist = await page.evaluate(() => window.office.cameraDist);
  await page.mouse.move(spot.mid, spot.y);
  await page.mouse.wheel(0, -480);
  await page.waitForTimeout(200);
  const zoomed = await page.evaluate(() => window.office.cameraDist);
  assert(zoomed < dist - 20, `坐著滾輪應該拉近，${dist.toFixed(0)} → ${zoomed.toFixed(0)}`);
  assert((await page.evaluate(() => window.office.seat)) === before.seat, "縮放不該起立");
  await page.mouse.click(spot.left, spot.y);
  await page.waitForTimeout(400);
  const afterClick = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y, seat: window.office.seat }));
  assert(afterClick.seat === before.seat, "坐著點地板不該起立");
  assert(Math.hypot(afterClick.x - before.x, afterClick.y - before.y) < 2, "坐著點地板不該走開");

  await page.evaluate(() => window.office.setView({ yaw: 1.15, pitch: 0.99, dist: 340 }));
  await settleView(page);
  await seeHeading(page, "sena", face);
  await shot(page, "seated-side");

  await page.getByRole("button", { name: "跟隨" }).click();
  await page.waitForFunction(() => window.office.cameraMode === "follow");
  await settleView(page);
  const followSpot = await openSpots(page, 180);
  const followCam = await camHeading(page);
  await dragAim(page, { x: followSpot.left, y: followSpot.y }, { x: followSpot.right, y: followSpot.y });
  await page.waitForTimeout(900);
  assert(angleGap(followCam, await camHeading(page)) > 0.7, "坐著跟隨時左鍵拖曳應該留下轉幅");
  await seeHeading(page, "sena", face);
  assert((await page.evaluate(() => window.office.seat)) === before.seat, "跟隨轉鏡頭不該起立");
  const followPos = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  assert(Math.hypot(followPos.x - before.x, followPos.y - before.y) < 2, "跟隨轉鏡頭不該滑走");
  await page.getByRole("button", { name: "俯瞰" }).click();
  await page.waitForFunction(() => window.office.cameraMode === "iso");

  await page.keyboard.press("e");
  await page.waitForFunction(() => !window.office.seat);
  const lala = await page.evaluate(() => window.office.me && ({ x: 224, y: 116 }));
  const front = { x: lala.x + 90, y: lala.y + 96 };
  await march(page, 224, 336);
  await march(page, 224, front.y);
  await march(page, front.x, front.y);
  await page.waitForTimeout(80);
  const frontWhere = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  const frontAim = Math.atan2(frontWhere.x - lala.x, frontWhere.y - lala.y);
  await page.waitForFunction((target) => {
    const shown = window.office.actorHeading("lala");
    if (typeof shown !== "number") return false;
    return Math.abs(Math.atan2(Math.sin(shown - target), Math.cos(shown - target))) < 0.35;
  }, frontAim, { timeout: 5000 });
  await page.evaluate(() => window.office.setView({ yaw: 0.15, pitch: 0.98, dist: 460 }));
  await settleView(page);
  await page.waitForTimeout(400);
  await shot(page, "lala-facing");

  const behind = { x: lala.x + 80, y: lala.y - 46 };
  await march(page, 420, front.y);
  await march(page, 420, behind.y);
  await march(page, behind.x, behind.y);
  await page.waitForTimeout(80);
  const behindWhere = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  assert(behindWhere.y < lala.y - 8, `玩家應在櫃檯靠牆側，實際 ${JSON.stringify(behindWhere)}`);
  await page.waitForFunction((wall) => {
    const shown = window.office.actorHeading("lala");
    if (typeof shown !== "number") return false;
    const roomGap = Math.abs(Math.atan2(Math.sin(shown), Math.cos(shown)));
    const wallGap = Math.abs(Math.atan2(Math.sin(shown - wall), Math.cos(shown - wall)));
    return roomGap < 0.35 && wallGap > 1.2;
  }, Math.PI, { timeout: 5000 });

  await page.close();
  await context.close();
}

async function restrooms(browser) {
  const setPassword = await fetch(`${ORIGIN}/api/office/admin/password`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, origin: ORIGIN },
    body: JSON.stringify({ password: PASS }),
  });
  assert(setPassword.ok, `廁所測試沒設好密碼 ${setPassword.status}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await register(page, "stall", "隔間", "貓");
  await assetsReady(page);
  const layout = await page.evaluate(() => {
    const table = window.office.furniture.find((item) => item.id === "sofa-table");
    const tableSize = table.rot % 180 === 0 ? { w: 88, h: 40 } : { w: 40, h: 88 };
    const tx = table.x + tableSize.w / 2;
    const ty = table.y + tableSize.h / 2;
    const sofas = ["sofa-left", "sofa-right"].map((id) => {
      const sofa = window.office.furniture.find((item) => item.id === id);
      const rad = ((((sofa.rot % 360) + 360) % 360) * Math.PI) / 180;
      const forward = { x: Math.sin(rad), y: Math.cos(rad) };
      const size = sofa.rot % 180 === 0 ? { w: 72, h: 36 } : { w: 36, h: 72 };
      const cx = sofa.x + size.w / 2;
      return { id, rot: sofa.rot, dot: forward.x * (tx - cx), side: forward.y, dy: Math.abs(ty - (sofa.y + size.h / 2)) };
    });
    const toilets = window.office.props.filter((item) => item.kind === "toilet");
    const urinals = window.office.props.filter((item) => item.kind === "urinal");
    const sinks = window.office.props.filter((item) => item.kind === "sink");
    return {
      sofas,
      menToilets: toilets.filter((item) => item.room === "men").length,
      womenToilets: toilets.filter((item) => item.room === "women").length,
      urinals: urinals.length,
      womenUrinals: urinals.filter((item) => item.room === "women").length,
      menSinks: sinks.filter((item) => item.room === "men").length,
      womenSinks: sinks.filter((item) => item.room === "women").length,
      sinkBlocks: sinks.every((sink) => window.office.blocked(sink.x + sink.w / 2, sink.y + sink.h / 2)),
      doorClear: !window.office.blocked(128, 820) && !window.office.blocked(320, 820),
    };
  });
  assert(layout.sofas.find((item) => item.id === "sofa-left").rot === 90, "左邊沙發應朝東");
  assert(layout.sofas.find((item) => item.id === "sofa-right").rot === 270, "右邊沙發應朝西");
  for (const sofa of layout.sofas) {
    assert(sofa.dot > 0 && Math.abs(sofa.side) < 1e-6, `${sofa.id} 沒有面向茶几`);
  }
  assert(layout.menToilets === 2 && layout.womenToilets === 2, "兩邊廁所都要有馬桶");
  assert(layout.urinals === 0 && layout.womenUrinals === 0, "廁所改成兩間隔間，不該再有小便斗");
  assert(layout.menSinks === 1 && layout.womenSinks === 1, "兩邊廁所各有一個洗手台");
  assert(layout.sinkBlocks, "洗手台應該擋路");
  assert(layout.doorClear, "廁所門口不該被洗手台擋住");

  await march(page, 1088, 336);
  await march(page, 1088, 820);
  await page.evaluate(() => {
    window.office.pose("sofa-right", 90);
    window.office.setView({ yaw: Math.PI, pitch: 0.62, dist: 680 });
  });
  await settleView(page);
  await page.waitForTimeout(400);
  await shot(page, "sofa-before");
  await page.evaluate(() => {
    window.office.pose("sofa-right", 270);
    window.office.setView({ yaw: Math.PI, pitch: 0.62, dist: 680 });
  });
  await settleView(page);
  await page.waitForTimeout(300);
  await shot(page, "sofa-after");

  await march(page, 1088, 336);
  await march(page, 128, 336);
  await march(page, 128, 860);
  await march(page, 96, 860);
  await page.evaluate(() => window.office.setView({ yaw: Math.PI, pitch: 0.62, dist: 520 }));
  await settleView(page);
  await page.waitForTimeout(250);
  const mirrorHint = await page.locator("#hint").innerText();
  assert(!mirrorHint.includes("開門"), `鏡子旁邊不該出現開門：${mirrorHint}`);

  await page.evaluate(() => window.office.setView({ yaw: Math.PI, pitch: 0.55, dist: 620 }));
  await settleView(page);
  await shot(page, "mens-restroom");
  await march(page, 72, 930);
  await page.evaluate(() => window.office.setView({ yaw: Math.PI * 0.85, pitch: 0.78, dist: 320 }));
  await settleView(page);
  await page.waitForFunction(() => (document.querySelector("#hint")?.textContent || "").includes("開門"));
  await shot(page, "stall-closed");

  const witnessContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const witness = await witnessContext.newPage();
  await register(witness, "stall2", "門", "狗");
  await assetsReady(witness);
  await page.waitForTimeout(200);
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.office.stallDoors.some((door) => door.id === "men-a" && door.open));
  await witness.waitForFunction(() => window.office.stallDoors.some((door) => door.id === "men-a" && door.open));
  const opened = await page.evaluate(() => ({
    gap: window.office.blocked(72, 973),
    leaf: window.office.blocked(53, 920),
  }));
  assert(opened.gap === false, "開門後門口應該走得過");
  assert(opened.leaf === true, "打開的門應該擋路");
  await page.waitForTimeout(700);
  await shot(page, "stall-open");

  // The room is five tiles wide, so the knocker waits in the office while the other player
  // steps into the door frame, then comes back to knock from beside it.
  await march(page, 128, 740);
  await march(page, 260, 740);
  await march(witness, 128, 336);
  await march(witness, 128, 860);
  await march(witness, 62, 973);
  await witness.waitForFunction(() => Math.hypot(window.office.me.x - 62, window.office.me.y - 973) < 4, null, { timeout: 5000 }).catch(async (error) => {
    const where = await witness.evaluate(() => ({
      me: { x: window.office.me.x, y: window.office.me.y },
      doors: window.office.stallDoors,
      blocked: [[62, 860], [62, 925], [62, 950], [62, 973]].map(([x, y]) => window.office.blocked(x, y)),
    }));
    throw new Error(`第二名玩家走不進門框 ${JSON.stringify(where)}`, { cause: error });
  });
  await march(page, 128, 740);
  await march(page, 128, 860);
  await march(page, 111, 928);
  await page.waitForFunction(() => {
    const other = window.office.others.find((item) => item.id === "stall2");
    return other && Math.hypot((other.tx ?? other.x) - 62, (other.ty ?? other.y) - 973) < 4;
  });
  await page.waitForTimeout(400);
  await page.keyboard.press("e");
  await page.waitForFunction(() => (document.querySelector("#hint")?.textContent || "").includes("門口有人"));
  await page.waitForTimeout(500);
  assert(await page.evaluate(() => window.office.stallDoors.some((door) => door.id === "men-a" && door.open)), "有人在門框時不該關門");
  assert(await witness.evaluate(() => window.office.stallDoors.some((door) => door.id === "men-a" && door.open)), "門框裡的人看到門被關上");
  await march(page, 128, 740);
  await march(page, 260, 740);
  await march(witness, 62, 900);
  await witness.waitForTimeout(400);
  const freed = await witness.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  assert(Math.hypot(freed.x - 62, freed.y - 900) < 4, `門框裡的人應該走得出來 ${JSON.stringify(freed)}`);
  await march(witness, 128, 336);
  await march(page, 128, 740);
  await march(page, 128, 860);
  await march(page, 72, 930);
  await page.waitForTimeout(400);
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.office.stallDoors.some((door) => door.id === "men-a" && !door.open));
  await witness.waitForFunction(() => window.office.stallDoors.some((door) => door.id === "men-a" && !door.open));
  const shut = await page.evaluate(() => ({
    gap: window.office.blocked(72, 973),
    leaf: window.office.blocked(53, 920),
  }));
  assert(shut.gap === true, "關門後門口應該擋住");
  assert(shut.leaf === false, "關上的門不該擋在外面");

  await march(witness, 640, 336);
  const cabinet = await page.evaluate(() => window.office.snackSpot("snackcab"));
  await march(page, 128, 336);
  await march(page, 1088, 336);
  await march(page, 1088, 820);
  await walkTo(page, cabinet.standX, cabinet.standY);
  const treat = await page.evaluate(() => ["cookie", "choco", "candy", "marsh"].find((id) => window.office.snackStock[id] > 0));
  assert(treat, "零食櫃沒有庫存");
  const left = await takeSnack(page, treat);
  await page.waitForFunction((id) => window.office.snackCarry === id && window.office.snackPhase() < 0, treat);
  await march(page, 1088, 820);
  await march(page, 1088, 336);
  await march(page, 128, 336);
  await march(page, 128, 860);
  await march(page, 72, 930);
  await page.waitForFunction(() => (document.querySelector("#hint")?.textContent || "").includes("按 E 開門"), null, { timeout: 5000 }).catch(async (error) => {
    const where = await page.evaluate(() => ({
      me: { x: window.office.me.x, y: window.office.me.y },
      hint: document.querySelector("#hint")?.textContent,
      carry: window.office.snackCarry,
    }));
    throw new Error(`拿著零食在門口沒有開門提示 ${JSON.stringify(where)}`, { cause: error });
  });
  await page.waitForTimeout(400);
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.office.stallDoors.some((door) => door.id === "men-a" && door.open));
  await page.waitForTimeout(400);
  assert(await page.evaluate((id) => window.office.snackCarry === id && window.office.snackPhase() < 0, treat), "在門口按 E 不該吃掉零食");
  assert((await page.evaluate((id) => window.office.snackStock[id], treat)) === left, "在門口按 E 不該動到零食");
  await page.waitForFunction(() => (document.querySelector("#hint")?.textContent || "").includes("按 E 關門"));
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.office.stallDoors.some((door) => door.id === "men-a" && !door.open));

  await march(page, 128, 860);
  await march(page, 128, 336);
  await march(page, 320, 336);
  await march(page, 320, 880);
  await page.waitForFunction(() => window.office.zone === "女廁");
  await page.evaluate(() => window.office.setView({ yaw: Math.PI, pitch: 0.55, dist: 620 }));
  await settleView(page);
  await shot(page, "womens-restroom");
  await march(page, 320, 336);
  await march(page, 496, 336);
  await march(page, 496, 900);
  await page.waitForFunction(() => window.office.zone === "健身房");
  await settleView(page);
  await shot(page, "gym");
  await march(page, 496, 336);
  await march(page, 768, 336);
  await march(page, 768, 860);
  await page.waitForFunction(() => window.office.zone === "茶水間");
  await settleView(page);
  await shot(page, "pantry");
  await witness.close();
  await witnessContext.close();
  await page.close();
  await context.close();

  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  await phoneRegister(phone, PASS, "stall3", "手機", "兔");
  await phone.getByRole("button", { name: "進入辦公室" }).click();
  await ready(phone);
  await assetsReady(phone);
  // Path-find through the narrow restroom door; straight-line steps can be snapped back on a busy runner.
  await walkTo(phone, 128, 880);
  await march(phone, 72, 940);
  await phone.evaluate(() => window.office.setView({ yaw: Math.PI * 0.85, pitch: 0.8, dist: 340 }));
  await settleView(phone);
  await phone.waitForFunction(() => window.office.actions.includes("開門"), null, { timeout: 8000 }).catch(async (error) => {
    const where = await phone.evaluate(() => ({ me: window.office.me && { x: window.office.me.x, y: window.office.me.y }, actions: window.office.actions, doors: window.office.stallDoors }));
    throw new Error(`手機在隔間門口沒有開門按鈕 ${JSON.stringify(where)}`, { cause: error });
  });
  await shot(phone, "stall-phone");
  await phone.close();
  await phoneContext.close();
}

async function chairHome(browser) {
  const setPassword = await fetch(`${ORIGIN}/api/office/admin/password`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, origin: ORIGIN },
    body: JSON.stringify({ password: PASS }),
  });
  assert(setPassword.ok, `椅子歸位測試沒設好密碼 ${setPassword.status}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const yuki = await context.newPage();
  await register(yuki, "yuki", "雪", "貓");
  const witnessContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const rio = await witnessContext.newPage();
  await register(rio, "rio", "里緒", "狗");
  await march(yuki, 224, 208);
  await yuki.keyboard.press("e");
  await yuki.getByRole("button", { name: "調整設備擺設" }).click();
  await yuki.waitForFunction(() => window.office.editing);
  await yuki.locator("#chairs-home").click();
  const facingHome = () => window.office.furniture.filter((item) => item.kind === "chair").every((item) => {
    if (item.id.startsWith("desk-")) return item.rot === 180;
    if (item.id.startsWith("meet-")) return item.rot === 0;
    return true;
  }) && window.office.furniture.filter((item) => item.id.startsWith("desk-") && item.kind === "chair").length === 10;
  await yuki.waitForFunction(facingHome);
  await rio.waitForFunction(facingHome);
  const agreed = await rio.evaluate(() => window.office.furniture
    .filter((item) => item.kind === "chair")
    .map((item) => [item.id, item.rot])
    .sort((a, b) => a[0].localeCompare(b[0])));
  const hostRots = await yuki.evaluate(() => window.office.furniture
    .filter((item) => item.kind === "chair")
    .map((item) => [item.id, item.rot])
    .sort((a, b) => a[0].localeCompare(b[0])));
  assert(JSON.stringify(hostRots) === JSON.stringify(agreed), "兩邊看到的椅子朝向不一樣");
  await yuki.locator("#edit-done").click();
  await yuki.waitForFunction(() => !window.office.editing);
  await assetsReady(yuki);
  const spot = await yuki.evaluate(() => {
    const item = window.office.furniture.find((furn) => furn.id === "desk-3-chair");
    return { id: item.id, x: item.x + 16, y: item.y + 13 };
  });
  await yuki.evaluate((where) => window.office.place(where.x, where.y + 80), spot);
  await yuki.evaluate(() => window.office.setView({ yaw: -0.15, dist: 520, pitch: 0.92 }));
  await settleView(yuki);
  await shot(yuki, "chairs-home-facing");
  await yuki.evaluate((where) => window.office.place(where.x, where.y), spot);
  await yuki.waitForTimeout(200);
  await yuki.keyboard.press("e");
  await yuki.waitForFunction((id) => window.office.seat === id, spot.id);
  await seeHeading(yuki, "yuki", Math.PI);
  await seeHeading(rio, "yuki", Math.PI);
  await yuki.evaluate(() => window.office.setView({ yaw: 1.45, dist: 300, pitch: 1.0 }));
  await settleView(yuki);
  await shot(yuki, "chair-seat-facing");
  await yuki.keyboard.press("e");
  await yuki.waitForFunction(() => !window.office.seat);
  await rio.close();
  await witnessContext.close();
  await yuki.close();
  await context.close();
}


async function panelRoutes() {
  const bare = await fetch(`${ORIGIN}${PANEL}`, { redirect: "manual" });
  assert(bare.status === 302 && new URL(bare.headers.get("location"), ORIGIN).pathname === `${PANEL}/`, `管理頁應轉到結尾斜線 ${bare.status}`);
  const page = await fetch(`${ORIGIN}${PANEL}/`);
  assert(page.status === 200 && (await page.text()).includes("seed-input"), `設定的路徑應該打得開管理頁 ${page.status}`);
  for (const file of ["panel.js", "panel.css"]) {
    const response = await fetch(`${ORIGIN}${PANEL}/${file}`);
    assert(response.status === 200, `${file} 應該在設定的路徑下 ${response.status}`);
  }
  // The old location is spelled out in pieces so the path itself is not written in the repo.
  const old = ["", "office", "admin"].join("/");
  for (const path of [old, `${old}/`, `${old}/index.html`, `${old}.js`, `${old}.css`, "/panel.js", "/panel/index.html"]) {
    const response = await fetch(`${ORIGIN}${path}`, { redirect: "manual" });
    assert(response.status === 404, `${path} 應該是 404，實際 ${response.status}`);
  }
}

async function coreOffice(browser) {
  await panelRoutes();
  const setPassword = await fetch(`${ORIGIN}/api/office/admin/password`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, origin: ORIGIN },
    body: JSON.stringify({ password: PASS }),
  });
  assert(setPassword.ok, `核心測試沒設好密碼 ${setPassword.status}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage();
  await register(host, "core", "核心", "貓");
  assert((await host.evaluate(() => window.office.connected)) === true, "登入後應該連上辦公室");
  const deskGap = await topbarGap(host);
  assert(deskGap.gap >= 8 && deskGap.hit === "view", `頂部左右兩塊中間應該點得到場景 ${JSON.stringify(deskGap)}`);
  await host.waitForFunction(() => document.querySelector(".brand .version")?.textContent);
  const version = await host.locator(".brand .version").textContent();
  assert(/^(v\d+\.\d+\.\d+( · [0-9a-f]{7})?|dev)$/.test(version), `標題下應該顯示版本號，實際 ${version}`);
  const scored = await host.evaluate(async () => {
    const [before, body] = await Promise.all([
      window.office.ask("leaderboard"),
      window.office.ask("score", { game: "zip", op: "solve" }),
    ]);
    const list = await window.office.ask("leaderboard");
    const zip = (list.games || []).find((game) => game.id === "zip");
    return {
      status: body.status,
      score: body.score,
      before: Array.isArray(before.games) && before.score === undefined,
      board: list.status,
      mine: zip?.me?.score ?? null,
    };
  });
  assert(scored.status === 200 && scored.score === 1 && scored.before && scored.board === 200 && scored.mine === 1, `分數沒記上 ${JSON.stringify(scored)}`);
  const socketRules = await host.evaluate(async () => {
    const huge = await window.office.ask("score", { game: "cat2048", score: 999999999 });
    const unknown = await window.office.ask("score", { game: "nope", op: "solve" });
    const again = await window.office.ask("setup", { animal: "fox" });
    window.office.socket.close();
    const queued = await window.office.ask("leaderboard");
    return { huge: huge.status, unknown: unknown.status, again: again.status, queued: queued.status, waiting: window.office.waiting };
  });
  assert(
    socketRules.huge === 400 && socketRules.unknown === 400 && socketRules.again === 403 && socketRules.queued === 200 && socketRules.waiting === 0,
    `連線上的請求規則不對 ${JSON.stringify(socketRules)}`,
  );
  await ready(host);
  for (const [path, method] of [["/api/office/score", "POST"], ["/api/office/leaderboard", "GET"], ["/api/office/me", "PUT"]]) {
    const gone = await host.evaluate(async ({ path, method }) => (await fetch(path, { method })).status, { path, method });
    assert(gone === 404, `${method} ${path} 應該已經移除，實際 ${gone}`);
  }
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await stranger.goto(`${ORIGIN}/`);
  const anonSocket = await stranger.evaluate(() => new Promise((resolve) => {
    const socket = new WebSocket(`${location.origin.replace("http", "ws")}/api/office/ws`);
    socket.onopen = () => resolve("open");
    socket.onclose = () => resolve("closed");
  }));
  assert(anonSocket === "closed", `未登入不該連上辦公室 ${anonSocket}`);
  await strangerContext.close();

  await host.locator("#pair-open").click();
  await host.waitForFunction(() => /\d{3}\s\d{3}/.test(document.querySelector("#pair-code")?.textContent || ""));
  const code = ((await host.locator("#pair-code").textContent()) || "").replace(/\D/g, "");
  assert(/^\d{6}$/.test(code), `代碼不對 ${code}`);
  const otherContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const other = await otherContext.newPage();
  await other.goto(`${ORIGIN}/`);
  await other.getByLabel("辦公室密碼").fill(PASS);
  await other.getByRole("button", { name: "進入", exact: true }).click();
  await other.getByRole("button", { name: "我已經有 ID" }).click();
  await other.locator("#pair-id").fill("core");
  await other.locator("#pair-code-input").fill(code);
  await other.getByRole("button", { name: "加入這台裝置" }).click();
  await ready(other);
  assert((await other.evaluate(() => window.office.me.id)) === "core", "第二台應該是同一個 ID");
  await host.getByRole("heading", { name: "已在其他裝置上線" }).waitFor();
  await host.getByRole("button", { name: "取回控制" }).click();
  await ready(host);
  await other.getByRole("heading", { name: "已在其他裝置上線" }).waitFor();
  await host.locator("#clock-btn").click();
  await host.getByRole("button", { name: "確定" }).click();
  await host.getByText("辛苦了，明天見！").waitFor();
  await other.locator("#gate-msg").getByText("已在其他裝置下班").waitFor();
  const both = await Promise.all([
    host.evaluate(async () => (await fetch("/api/office/me")).status),
    other.evaluate(async () => (await fetch("/api/office/me")).status),
  ]);
  assert(both[0] === 401 && both[1] === 401, `下班後兩邊都應登出 ${both.join(",")}`);

  await host.getByLabel("辦公室密碼").fill(PASS);
  await host.getByRole("button", { name: "進入", exact: true }).click();
  await ready(host);
  assert((await host.evaluate(() => window.office.me.id)) === "core", "下班後應該用原 ID 回來");
  const changed = await fetch(`${ORIGIN}/api/office/admin/password`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, origin: ORIGIN },
    body: JSON.stringify({ password: PASS2 }),
  });
  assert(changed.ok, `換密碼失敗 ${changed.status}`);
  await host.getByText("密碼已更新").waitFor();
  await host.getByLabel("辦公室密碼").fill(PASS);
  await host.getByRole("button", { name: "進入", exact: true }).click();
  await host.getByText("密碼不正確").waitFor();
  await host.getByLabel("辦公室密碼").fill(PASS2);
  await host.getByRole("button", { name: "進入", exact: true }).click();
  await ready(host);
  assert((await host.evaluate(() => window.office.me.id)) === "core", "換密碼後 ID 不對");
  await other.close();
  await otherContext.close();
  await host.close();
  await context.close();
}

async function sofaAndUnstuck(browser) {
  const setPassword = await fetch(`${ORIGIN}/api/office/admin/password`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, origin: ORIGIN },
    body: JSON.stringify({ password: PASS }),
  });
  assert(setPassword.ok, `茶几測試沒設好密碼 ${setPassword.status}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await register(page, "mori", "茉莉", "兔");
  await settleView(page);
  const witnessContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const witness = await witnessContext.newPage();
  await register(witness, "sora", "空", "狐");
  await page.waitForFunction(() => window.office.others.some((person) => person.id === "sora"));
  await witness.waitForFunction(() => window.office.others.some((person) => person.id === "mori"));
  for (const [viewer, ids] of [[page, ["mori", "sora", "lala"]], [witness, ["sora", "mori"]]]) {
    for (const id of ids) {
      await viewer.waitForFunction((who) => window.office.outlineCount(who) >= 0, id);
      const outlines = await viewer.evaluate((who) => window.office.outlineCount(who), id);
      assert(outlines === 0, `角色 ${id} 不該有描邊，找到 ${outlines}`);
    }
  }

  const deskStyle = await page.evaluate(() => {
    const button = document.querySelector("#unstuck-btn");
    const help = document.querySelector("#help-btn");
    const box = button.getBoundingClientRect();
    const helpBox = help.getBoundingClientRect();
    const b = getComputedStyle(button);
    const h = getComputedStyle(help);
    return {
      text: button.textContent,
      height: box.height,
      helpH: helpBox.height,
      radius: b.borderRadius,
      helpRadius: h.borderRadius,
      pad: b.padding,
      helpPad: h.padding,
      top: document.querySelector("#topbar").getBoundingClientRect().height,
    };
  });
  assert(deskStyle.text === "緊急急救", `按鈕文字不對 ${deskStyle.text}`);
  assert(deskStyle.height === deskStyle.helpH && deskStyle.height >= 40, `桌面急救按鈕高度不對 ${JSON.stringify(deskStyle)}`);
  assert(deskStyle.radius === deskStyle.helpRadius, `桌面急救按鈕圓角不對 ${deskStyle.radius}`);
  assert(deskStyle.pad === deskStyle.helpPad, `桌面急救按鈕內距不對 ${deskStyle.pad}`);
  assert(deskStyle.top <= 64, `桌面頂部列太高 ${deskStyle.top}`);
  const deskGap = await topbarGap(page);
  assert(deskGap.gap >= 8 && deskGap.hit === "view", `桌面頂部左右兩塊重疊 ${JSON.stringify(deskGap)}`);
  await shot(page, "emergency-button-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#cam-btn").waitFor();
  const phoneStyle = await page.evaluate(() => {
    const button = document.querySelector("#unstuck-btn");
    const cam = document.querySelector("#cam-btn");
    const box = button.getBoundingClientRect();
    const camBox = cam.getBoundingClientRect();
    const b = getComputedStyle(button);
    const c = getComputedStyle(cam);
    const top = document.querySelector("#topbar").getBoundingClientRect();
    return {
      text: button.textContent,
      height: box.height,
      camH: camBox.height,
      radius: b.borderRadius,
      camRadius: c.borderRadius,
      topH: top.height,
      left: box.left,
      right: box.right,
      width: box.width,
      view: window.innerWidth,
      roomScroll: document.querySelector("#room-label").scrollWidth,
      roomClient: document.querySelector("#room-label").clientWidth,
    };
  });
  assert(phoneStyle.text === "緊急急救", "手機上看不到緊急急救");
  assert(phoneStyle.roomScroll <= phoneStyle.roomClient + 1, `手機上房間名稱被擠掉 ${JSON.stringify(phoneStyle)}`);
  assert(Math.abs(phoneStyle.height - phoneStyle.camH) < 1 && phoneStyle.height >= 44, `手機急救按鈕高度不對 ${JSON.stringify(phoneStyle)}`);
  assert(phoneStyle.radius === phoneStyle.camRadius, `手機急救按鈕圓角不對 ${phoneStyle.radius}`);
  assert(phoneStyle.topH <= 64, `手機頂部列換行了 ${phoneStyle.topH}`);
  assert(phoneStyle.left >= 4 && phoneStyle.right <= phoneStyle.view - 4 && phoneStyle.width >= 64, `手機急救按鈕被裁切 ${JSON.stringify(phoneStyle)}`);
  const phoneGap = await topbarGap(page);
  assert(phoneGap.gap >= 8 && phoneGap.hit === "view", `手機頂部左右兩塊重疊 ${JSON.stringify(phoneGap)}`);
  await shot(page, "emergency-button-phone");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => !window.office.phone);

  await march(page, 224, 208);
  await page.keyboard.press("e");
  await page.getByRole("button", { name: "調整設備擺設" }).click();
  await page.waitForFunction(() => window.office.editing);
  const origin = await page.evaluate(() => {
    const item = window.office.furniture.find((furn) => furn.id === "sofa-table");
    return item ? { x: item.x, y: item.y } : null;
  });
  assert(origin, "找不到沙發區茶几");
  await page.evaluate((spot) => {
    window.office.focusOn(spot.x + 44, spot.y + 20);
    window.office.setView({ yaw: 0.35, pitch: 0.95, dist: 380 });
  }, origin);
  let framed = null;
  for (let i = 0; i < 40; i++) {
    framed = await page.evaluate((spot) => {
      const point = window.office.worldToScreen(spot.x + 44, spot.y + 20);
      const dest = window.office.worldToScreen(spot.x + 44 + 72, spot.y - 20);
      const bar = document.getElementById("editbar").getBoundingClientRect().bottom;
      const onScreen = (mark) => mark.x > 48 && mark.x < window.innerWidth - 48 && mark.y > bar + 12 && mark.y < window.innerHeight - 24;
      const prev = window.__tableStable;
      window.__tableStable = { x: point.x, y: point.y, dx: dest.x, dy: dest.y };
      const still = prev
        && Math.hypot(point.x - prev.x, point.y - prev.y) < 0.5
        && Math.hypot(dest.x - prev.dx, dest.y - prev.dy) < 0.5;
      return { point, dest, bar, still, ok: Boolean(still && onScreen(point) && onScreen(dest)) };
    }, origin);
    if (framed.ok) break;
    await page.waitForTimeout(150);
  }
  assert(framed?.ok, `茶几不在可拖曳的畫面裡 ${JSON.stringify(framed)}`);
  const drag = await page.evaluate((spot) => ({
    from: window.office.worldToScreen(spot.x + 44, spot.y + 20),
    to: window.office.worldToScreen(spot.x + 44 + 72, spot.y - 20),
  }), origin);
  await page.mouse.move(drag.from.x, drag.from.y);
  await page.mouse.down();
  await page.mouse.move(drag.to.x, drag.to.y, { steps: 10 });
  await page.mouse.up();
  await witness.waitForFunction((start) => {
    const item = window.office.furniture.find((furn) => furn.id === "sofa-table");
    return item && Math.hypot(item.x - start.x, item.y - start.y) > 24;
  }, origin);
  const moved = await page.evaluate((start) => {
    const item = window.office.furniture.find((furn) => furn.id === "sofa-table");
    return { x: item.x, y: item.y, kind: item.kind, dx: item.x - start.x, dy: item.y - start.y };
  }, origin);
  assert(moved.kind === "coffeetable", `茶几種類不對 ${moved.kind}`);
  assert(Math.abs(moved.dx) > 16 || Math.abs(moved.dy) > 16, `茶几沒有移動 ${JSON.stringify(moved)}`);
  const agreed = await witness.evaluate(() => {
    const item = window.office.furniture.find((furn) => furn.id === "sofa-table");
    return { x: item.x, y: item.y };
  });
  assert(agreed.x === moved.x && agreed.y === moved.y, `另一位沒看到茶几移動 ${JSON.stringify(agreed)} ${JSON.stringify(moved)}`);
  await page.evaluate((spot) => window.office.focusOn(spot.x + 44, spot.y + 20), moved);
  await assetsReady(page).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, "sofa-table-moved");

  const stockBefore = await page.evaluate(() => ({ ...window.office.snackStock }));
  const furnBefore = await witness.evaluate(() => window.office.furniture
    .map((item) => [item.id, item.x, item.y, item.rot, item.seat || ""])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  await page.locator("#edit-done").click();
  await page.waitForFunction(() => !window.office.editing);
  const chair = await page.evaluate(() => {
    const item = window.office.furniture.find((furn) => furn.kind === "chair" && !furn.seat && furn.id.startsWith("desk-"));
    return item ? { id: item.id, x: item.x + 16, y: item.y + 13 } : null;
  });
  assert(chair, "找不到空椅子");
  await walkTo(page, chair.x, chair.y + 48);
  await page.waitForTimeout(250);
  await sitDown(page, chair.id);
  const seated = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y, seat: window.office.seat }));
  const witnessAt = await witness.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y, seat: window.office.seat }));
  await page.locator("#unstuck-btn").click();
  const home = await page.evaluate(() => window.office.spawn);
  await page.waitForFunction((spot) => {
    const me = window.office.me;
    if (!me || window.office.seat) return false;
    return Math.hypot(me.x - spot.x, me.y - spot.y) < 280;
  }, home);
  const back = await page.evaluate(() => ({
    x: window.office.me.x,
    y: window.office.me.y,
    seat: window.office.seat,
    hint: document.querySelector("#hint")?.textContent || "",
    bubble: window.office.bubbles.some((item) => item.id === window.office.me.id && item.text === "已回到安全位置"),
  }));
  assert(!back.seat, "急救後應該站著");
  assert(Math.hypot(back.x - seated.x, back.y - seated.y) > 80, `急救後還在椅子附近 ${JSON.stringify(back)}`);
  assert(Math.hypot(back.x - home.x, back.y - home.y) < 280, `沒有回到出生點 ${JSON.stringify(back)} ${JSON.stringify(home)}`);
  assert(back.bubble || back.hint.includes("已回到安全位置"), `沒有安全位置提示 ${back.hint}`);
  await witness.waitForFunction(() => window.office.others.some((person) => person.id === "mori" && !person.seat));
  const witnessStill = await witness.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y, seat: window.office.seat }));
  assert(!witnessStill.seat && Math.hypot(witnessStill.x - witnessAt.x, witnessStill.y - witnessAt.y) < 8, `另一位被一起送走 ${JSON.stringify(witnessStill)}`);
  const furnAfter = await witness.evaluate(() => window.office.furniture
    .map((item) => [item.id, item.x, item.y, item.rot, item.seat || ""])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  assert(JSON.stringify(furnAfter) === JSON.stringify(furnBefore), "急救不該改動家具");
  const stockAfter = await page.evaluate(() => window.office.snackStock);
  assert(JSON.stringify(stockAfter) === JSON.stringify(stockBefore), "急救不該改動零食存量");
  await page.evaluate(() => window.office.setView({ yaw: 0.4, pitch: 0.9, dist: 420 }));
  await settleView(page);
  await shot(page, "avatar-at-spawn");
  await witness.close();
  await witnessContext.close();
  await page.close();
  await context.close();
}

// march() teleports in small steps; the server can still be a step behind, so retry E a few times.
async function sitDown(page, id) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.keyboard.press("e");
    try {
      await page.waitForFunction((chair) => window.office.seat === chair, id, { timeout: 2500 });
      return;
    } catch {
      await page.waitForTimeout(300);
    }
  }
  const where = await page.evaluate(() => ({ me: window.office.me, hint: document.querySelector("#hint")?.textContent || "" }));
  throw new Error(`坐不到 ${id} ${JSON.stringify(where)}`);
}

function spawnSpot(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return { x: 656 + ((hash % 7) - 3) * 72, y: 336 };
}

async function startEditing(page) {
  await march(page, 224, 208);
  await page.keyboard.press("e");
  await page.getByRole("button", { name: "調整設備擺設" }).click();
  await page.waitForFunction(() => window.office.editing);
}

async function moveFurniture(page, id, x, y) {
  // The server drops moves sent within 150 ms of the previous one.
  await page.waitForTimeout(200);
  await page.evaluate(({ id, x, y }) => window.office.socket.send(JSON.stringify({ t: "furn", op: "move", id, x, y })), { id, x, y });
  await page.waitForFunction(({ id, x, y }) => {
    const item = window.office.furniture.find((furn) => furn.id === id);
    return item && item.x === x && item.y === y;
  }, { id, x, y }, { timeout: 8000 }).catch(async (error) => {
    const hint = await page.evaluate(() => document.querySelector("#hint")?.textContent || "");
    throw new Error(`${id} 沒有移到 ${x},${y}（${hint}）`, { cause: error });
  });
}

async function reviewFixes(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await register(page, "rina", "莉奈", "貓");
  await settleView(page);
  const tableHome = await page.evaluate(() => {
    const item = window.office.furniture.find((furn) => furn.id === "sofa-table");
    return { x: item.x, y: item.y };
  });

  // Fixed snack machines cannot be picked up in edit mode.
  await startEditing(page);
  const vendor = await page.evaluate(() => {
    const item = window.office.furniture.find((furn) => furn.kind === "vendor");
    return { id: item.id, x: item.x + 16, y: item.y + 15 };
  });
  await page.evaluate((spot) => {
    window.office.focusOn(spot.x, spot.y);
    window.office.setView({ yaw: 0.35, pitch: 0.95, dist: 380 });
  }, vendor);
  await page.waitForTimeout(900);
  const vendorAt = await page.evaluate((spot) => window.office.worldToScreen(spot.x, spot.y), vendor);
  await page.mouse.click(vendorAt.x, vendorAt.y);
  await page.waitForTimeout(200);
  const picked = await page.evaluate(() => ({ selected: window.office.selected, rot: document.querySelector("#furn-rot").disabled }));
  assert(picked.selected !== vendor.id && picked.rot, `編輯模式不該選得到販賣機 ${JSON.stringify(picked)}`);

  // Put the coffee table on this player's spawn, then ride a chair and use the emergency reset.
  const home = spawnSpot("rina");
  const blockX = Math.round((home.x - 44) / 4) * 4;
  // The hall is two tiles tall (y 320–384), so keep the table inside it while covering the spawn point.
  const blockY = 324;
  await moveFurniture(page, "sofa-table", blockX, blockY);
  await page.locator("#edit-done").click();
  await page.waitForFunction(() => !window.office.editing);
  const chair = await page.evaluate(() => {
    const item = window.office.furniture.find((furn) => furn.id === "desk-2-chair");
    return { id: item.id, x: item.x + 16, y: item.y + 13, ox: item.x, oy: item.y };
  });
  await walkTo(page, chair.x, chair.y + 48);
  await page.waitForTimeout(250);
  await sitDown(page, chair.id);
  await page.evaluate(() => window.office.drive(0, 1));
  await page.waitForFunction((start) => {
    const item = window.office.furniture.find((furn) => furn.id === start.id);
    return item && Math.hypot(item.x - start.ox, item.y - start.oy) > 40;
  }, chair);
  await page.evaluate(() => window.office.drive(0, 0));
  await page.waitForTimeout(400);
  await page.locator("#unstuck-btn").click();
  await page.waitForFunction(() => !window.office.seat);
  const landed = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  const table = { x: blockX, y: blockY, w: 88, h: 40 };
  const nx = Math.max(table.x, Math.min(landed.x, table.x + table.w));
  const ny = Math.max(table.y, Math.min(landed.y, table.y + table.h));
  assert(Math.hypot(landed.x - nx, landed.y - ny) >= 10, `急救把人送進茶几 ${JSON.stringify(landed)} ${JSON.stringify(table)}`);
  assert(Math.hypot(landed.x - home.x, landed.y - home.y) < 320, `急救離出生點太遠 ${JSON.stringify(landed)}`);
  const seen = await page.evaluate((id) => {
    const item = window.office.furniture.find((furn) => furn.id === id);
    return { x: item.x, y: item.y };
  }, chair.id);
  const backup = await fetch(`${ORIGIN}/api/office/admin/export`, { headers: { authorization: `Bearer ${ADMIN}` } });
  assert(backup.ok, `匯出失敗 ${backup.status}`);
  const savedChair = (await backup.json()).furniture.find((row) => row.id === chair.id);
  assert(Math.hypot(Number(savedChair.x) - seen.x, Number(savedChair.y) - seen.y) < 8, `急救後椅子位置沒存 ${JSON.stringify(savedChair)} ${JSON.stringify(seen)}`);

  // A second reset right away is refused.
  await page.evaluate(() => window.office.socket.send(JSON.stringify({ t: "reset" })));
  await page.locator("#hint", { hasText: "剛剛才急救過" }).waitFor();

  // Holding a snack in the restroom: the hint and E both eat.
  await walkTo(page, 176, 912);
  await page.waitForFunction(() => window.office.zone === "男廁");
  await page.waitForFunction(() => document.querySelector("#hint")?.textContent === "按 E 調整造型");
  const me = await page.evaluate(() => window.office.me.id);
  await page.evaluate((id) => window.office.feed({ t: "snacks", hold: { id, item: "cookie", pose: "eat", replaced: false } }), me);
  await page.waitForFunction(() => document.querySelector("#hint")?.textContent === "按 E 吃點心");
  await page.evaluate((id) => window.office.feed({ t: "snacks", use: { id, item: "cookie", pose: "eat" } }), me);
  await page.waitForFunction(() => window.office.snackCarry === "" && window.office.snackPhase() < 0, null, { timeout: 8000 });

  // Seated: tapping Lala talks to her and keeps the chair.
  await walkTo(page, 224, 208);
  await startEditing(page);
  await moveFurniture(page, "sofa-table", tableHome.x, tableHome.y);
  await moveFurniture(page, chair.id, 208, 196);
  await page.locator("#edit-done").click();
  await page.waitForFunction(() => !window.office.editing);
  await march(page, 224, 252);
  await sitDown(page, chair.id);
  await page.evaluate(() => {
    window.office.focusOn(224, 150);
    window.office.setView({ yaw: 0, pitch: 0.95, dist: 380 });
  });
  await page.waitForTimeout(900);
  const lalaAt = await page.evaluate(() => window.office.worldToScreen(224, 116));
  await page.mouse.click(lalaAt.x, lalaAt.y);
  await page.locator("#dialogue").waitFor();
  assert((await page.evaluate(() => window.office.seat)) === chair.id, "坐著點 Lala 不該起立");
  await page.locator("#btn-later").click();

  // Narrow phone: the emergency button needs a second tap and does not push the room name out.
  await page.locator("#unstuck-btn").click();
  await page.waitForFunction(() => !window.office.seat);
  for (const width of [375, 360]) {
    await page.setViewportSize({ width, height: 740 });
    await page.waitForFunction(() => window.office.phone);
    await page.waitForTimeout(1600);
    const narrow = await page.evaluate(() => {
      const label = document.querySelector("#room-label");
      const box = label.getBoundingClientRect();
      const button = document.querySelector("#unstuck-btn").getBoundingClientRect();
      return { w: box.width, scroll: label.scrollWidth, client: label.clientWidth, left: box.left, bRight: button.right, view: window.innerWidth };
    });
    assert(narrow.w >= 40 && narrow.scroll <= narrow.client + 1 && narrow.left >= 0, `${width}px 房間名稱被擠掉 ${JSON.stringify(narrow)}`);
    assert(narrow.bRight <= narrow.view - 4, `${width}px 急救按鈕超出畫面 ${JSON.stringify(narrow)}`);
    const narrowGap = await topbarGap(page);
    assert(narrowGap.gap >= 8, `${width}px 頂部兩塊重疊 ${JSON.stringify(narrowGap)}`);
    await shot(page, `emergency-button-${width}`);
  }
  // The talk spot now has the moved chair on it, so stand a little to the side.
  await walkTo(page, 320, 240);
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  const iconOnly = await page.evaluate(() => {
    const button = document.querySelector("#unstuck-btn");
    const cam = document.querySelector("#cam-btn");
    const b = getComputedStyle(button);
    const c = getComputedStyle(cam);
    return { name: button.getAttribute("aria-label"), w: button.getBoundingClientRect().width, camW: cam.getBoundingClientRect().width, radius: b.borderRadius, camRadius: c.borderRadius };
  });
  assert(iconOnly.name === "緊急急救" && Math.abs(iconOnly.w - iconOnly.camW) < 1 && iconOnly.radius === iconOnly.camRadius, `窄螢幕急救按鈕樣式不一致 ${JSON.stringify(iconOnly)}`);
  await page.locator("#unstuck-btn").click();
  await page.waitForFunction(() => {
    const button = document.querySelector("#unstuck-btn");
    return button.classList.contains("armed") && button.getAttribute("aria-label") === "再按一次"
      && (document.querySelector("#hint")?.textContent || "").startsWith("再按一次");
  });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
  assert(Math.hypot(after.x - before.x, after.y - before.y) < 4, "手機按一次就送走了");
  const armed = await topbarGap(page);
  assert(armed.gap >= 8, `確認狀態時頂部兩塊重疊 ${JSON.stringify(armed)}`);
  await page.locator("#unstuck-btn").click();
  await page.waitForFunction((from) => Math.hypot(window.office.me.x - from.x, window.office.me.y - from.y) > 60, before);
  await page.waitForFunction(() => document.querySelector("#unstuck-btn").getAttribute("aria-label") === "緊急急救");
  await page.close();
  await context.close();
}

async function main() {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  // Another dev server on this port would answer instead of ours and the run would test the wrong office.
  const taken = await fetch(`${ORIGIN}/`).then(() => true, () => false);
  assert(!taken, `連接埠 ${PORT} 已被佔用，請用 E2E_PORT 換一個`);
  const proc = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      String(PORT),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      join(RUN, "do"),
      "--var",
      `APP_SEED:${ADMIN}`,
      "--var",
      `APP_SLUG:${PANEL}/`,
    ],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    },
  );
  proc.stdout.on("data", (chunk) => process.stdout.write(chunk));
  proc.stderr.on("data", (chunk) => process.stderr.write(chunk));
  let browser;
  try {
    await waitHttp();
    for (let i = 0; i < 40; i++) {
      const status = await fetch(`${ORIGIN}/api/office/status`);
      if (status.ok) break;
      if (i === 39) throw new Error(`狀態 API ${status.status}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const healthAnon = await fetch(`${ORIGIN}/api/office/admin/health`);
    assert(healthAnon.status === 401, `未授權 health 應為 401，實際 ${healthAnon.status}`);
    const healthResponse = await fetch(`${ORIGIN}/api/office/admin/health`, {
      headers: { authorization: `Bearer ${ADMIN}` },
    });
    const health = await healthResponse.json();
    assert(healthResponse.ok && health.ok === true, `health 應看到密鑰，實際 ${JSON.stringify(health)}`);
    assert(Object.keys(health).length === 1, "health 不該帶出密鑰內容");
    const spoof = await fetch(`${ORIGIN}/api/office/admin/overview`, { headers: { "x-office-admin": "1" } });
    assert(spoof.status === 401, `偽造管理標頭應為 401，實際 ${spoof.status}`);
    const cross = await fetch(`${ORIGIN}/api/office/logout`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    assert(cross.status === 403, `跨來源應為 403，實際 ${cross.status}`);
    await adminSessions();
    if (process.argv.includes("--sessions")) {
      console.log("e2e ok");
      return;
    }

    browser = await chromium.launch({
      args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
    });
    if (process.argv.includes("--mobile")) {
      const setPassword = await fetch(`${ORIGIN}/api/office/admin/password`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, origin: ORIGIN },
        body: JSON.stringify({ password: PASS }),
      });
      assert(setPassword.ok, `手機測試沒設好密碼 ${setPassword.status}`);
      await mobileOffice(browser, PASS);
      publishShots();
      console.log("e2e ok");
      return;
    }
    if (process.argv.includes("--stalls")) {
      try {
        await restrooms(browser);
        console.log("stalls ok");
      } finally {
        publishShots();
      }
      return;
    }
    if (process.argv.includes("--toys")) {
      try {
        await toyRoom(browser);
      } finally {
        publishShots();
      }
      return;
    }
    if (process.argv.includes("--core")) {
      await snackLounge(browser);
      await toyRoom(browser);
      await removedDeviceCanRegister(browser);
      await chatModeAndCamera(browser);
      await phoneCamera(browser);
      await seatedCamera(browser);
      publishShots();
      await coreOffice(browser);
      await chairHome(browser);
      await restrooms(browser);
      await sofaAndUnstuck(browser);
      await reviewFixes(browser);
      publishShots();
      console.log("e2e ok");
      return;
    }
    if (SHARD === "phone") {
      const setPassword = await fetch(`${ORIGIN}/api/office/admin/password`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}`, origin: ORIGIN },
        body: JSON.stringify({ password: PASS }),
      });
      assert(setPassword.ok, `手機測試沒設好密碼 ${setPassword.status}`);
      await mobileOffice(browser, PASS);
      await toyRoom(browser);
      publishShots();
      console.log("e2e ok");
      return;
    }
    const lobby = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const officeRedirect = await fetch(`${ORIGIN}/office/`, { redirect: "manual" });
    assert(officeRedirect.status === 302, `/office 應轉到首頁，實際 ${officeRedirect.status}`);
    assert(new URL(officeRedirect.headers.get("location"), ORIGIN).pathname === "/", "轉址目標應為 /");

    await lobby.goto(`${ORIGIN}/`);
    await lobby.getByRole("heading", { name: "迷你辦公室" }).waitFor();
    await lobby.goto(`${ORIGIN}/games`);
    await lobby.getByRole("heading", { name: "小遊戲大廳" }).waitFor();
    await lobby.getByRole("link", { name: /燒肉屋/ }).waitFor();
    assert(await lobby.getByRole("link", { name: /辦公室/ }).count() === 0, "獨立大廳不該有辦公室連結");
    assert(await lobby.getByRole("button", { name: /辦公室/ }).count() === 0, "獨立大廳不該有辦公室按鈕");
    assert(!(await lobby.locator("#lobby").innerText()).includes("辦公室"), "獨立大廳不該提到辦公室");
    await shot(lobby, "lobby");
    await lobby.goto(`${ORIGIN}/games#zip`);
    await lobby.locator("#gname", { hasText: "Zip" }).waitFor();
    await lobby.getByRole("button", { name: "← 大廳" }).click();
    await lobby.getByRole("heading", { name: "小遊戲大廳" }).waitFor();
    const scorePosts = [];
    lobby.on("request", (request) => {
      if (request.url().includes("/api/office/")) scorePosts.push(request.url());
    });
    await lobby.evaluate(() => window.postMessage({ officeSolve: "zip" }, location.origin));
    await lobby.waitForTimeout(200);
    assert(scorePosts.length === 0, "獨立大廳不該送出分數");

    async function readCatTile(page) {
      await page.locator("#gname", { hasText: "2048 貓咪進化" }).waitFor();
      const frame = page.frameLocator("#f-cat2048");
      const img = frame.locator(".tile img").first();
      await img.waitFor();
      await page.waitForTimeout(300);
      return img.evaluate(async (el) => {
        if (!el.complete || el.naturalWidth === 0) {
          await new Promise((resolve) => {
            el.addEventListener("load", resolve, { once: true });
            el.addEventListener("error", resolve, { once: true });
          });
        }
        const tile = el.closest(".tile");
        const face = el.parentElement;
        const tileBox = tile.getBoundingClientRect();
        const imgBox = el.getBoundingClientRect();
        return {
          src: el.getAttribute("src"),
          naturalWidth: el.naturalWidth,
          naturalHeight: el.naturalHeight,
          fit: getComputedStyle(el).objectFit,
          tileW: Math.round(tileBox.width),
          tileH: Math.round(tileBox.height),
          imgW: Math.round(imgBox.width),
          imgH: Math.round(imgBox.height),
          badge: face.querySelector(".num")?.textContent || "",
          radius: Number.parseFloat(getComputedStyle(face).borderRadius),
        };
      });
    }
    await lobby.goto(`${ORIGIN}/games#cat2048`);
    const catTile = await readCatTile(lobby);
    assert(
      catTile.src === "/games/cat2048/01_orange_cat.webp" || catTile.src === "/games/cat2048/02_white_cat.webp",
      `起始貓咪圖應為橘貓或白貓，實際 ${JSON.stringify(catTile)}`,
    );
    assert(catTile.naturalWidth === 256 && catTile.naturalHeight === 256, `貓咪圖應為 256 正方形，實際 ${JSON.stringify(catTile)}`);
    assert(catTile.fit === "cover", `貓咪圖應 cover，實際 ${JSON.stringify(catTile)}`);
    assert(catTile.tileW === catTile.tileH && catTile.tileW > 40, `格子應維持正方形，實際 ${JSON.stringify(catTile)}`);
    assert(Math.abs(catTile.imgW - catTile.tileW) <= 2 && Math.abs(catTile.imgH - catTile.tileH) <= 2, `圖片應填滿格子，實際 ${JSON.stringify(catTile)}`);
    assert(catTile.badge === "2" || catTile.badge === "4", `數字徽章應可讀，實際 ${JSON.stringify(catTile)}`);
    assert(catTile.radius >= 8, `格子應有圓角，實際 ${JSON.stringify(catTile)}`);
    await shot(lobby, "cat2048");
    const catSrcdoc = await lobby.locator("#f-cat2048").getAttribute("srcdoc");
    assert(catSrcdoc.includes("10_star_cat.webp") && catSrcdoc.includes("glow:1"), "2048 以上應沿用星星貓並加上金光");
    await lobby.evaluate(() => {
      window.__catSave = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 2500);
        addEventListener("message", function onMsg(event) {
          const data = event.data && event.data.lobbySave;
          if (!data || data.key !== "cat2048") return;
          removeEventListener("message", onMsg);
          clearTimeout(timer);
          resolve(data.val);
        });
      });
    });
    await lobby.frameLocator("#f-cat2048").locator("body").evaluate(() => {
      for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      }
    });
    const catSaved = await lobby.evaluate(() => window.__catSave);
    assert(catSaved && Number.isFinite(catSaved.best), `移動後應回報分數，實際 ${JSON.stringify(catSaved)}`);
    await lobby.frameLocator("#f-cat2048").getByRole("button", { name: "📖 貓咪圖鑑" }).click();
    await lobby.frameLocator("#f-cat2048").locator("#dex img").nth(10).waitFor();
    assert(await lobby.frameLocator("#f-cat2048").locator("#dex img").count() === 11, "圖鑑應列出 2 到 2048");
    await shot(lobby, "cat2048-dex");

    const arcadeLobby = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await arcadeLobby.goto(`${ORIGIN}/games/?from=office`);
    await arcadeLobby.getByRole("button", { name: "回到辦公室" }).click();
    await arcadeLobby.waitForURL((url) => url.pathname === "/");
    await arcadeLobby.goto(`${ORIGIN}/games/?from=office#cat2048`);
    await arcadeLobby.getByRole("button", { name: "回到辦公室" }).waitFor();
    const arcadeTile = await readCatTile(arcadeLobby);
    assert(arcadeTile.src.startsWith("/games/cat2048/") && arcadeTile.naturalWidth === 256, `街機覆蓋層也應載入同一批圖，實際 ${JSON.stringify(arcadeTile)}`);
    await arcadeLobby.close();
    await lobby.close();

    const adminContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const nacoContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const momoContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const admin = await adminContext.newPage();
    const naco = await nacoContext.newPage();
    const momo = await momoContext.newPage();
    for (const page of [admin, naco, momo]) {
      page.on("pageerror", (error) => console.log("PAGE", error.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") console.log("CONSOLE", msg.text());
      });
    }
    admin.on("dialog", (dialog) => dialog.accept());

    await admin.goto(`${ORIGIN}${PANEL}`);
    await admin.getByLabel("密碼", { exact: true }).fill(ADMIN);
    await admin.getByRole("button", { name: "進入", exact: true }).click();
    const pwState = admin.locator("#pw-state");
    await admin.waitForFunction(() => {
      const text = document.querySelector("#pw-state")?.textContent || "";
      return text.includes("尚未設定") || text.includes("已設定");
    });
    if ((await pwState.textContent())?.includes("尚未設定")) {
      await admin.getByLabel("新的辦公室密碼").fill(PASS);
      await admin.getByLabel("再輸入一次").fill(PASS);
      await admin.getByRole("button", { name: "儲存新密碼" }).click();
      await admin.getByText("已更新密碼").waitFor();
    }

    await naco.goto(`${ORIGIN}/`);
    await naco.getByLabel("辦公室密碼").waitFor();
    await shot(naco, "entry-password");

    const bad = await nacoContext.request.post(`${ORIGIN}/api/office/login`, {
      data: { password: "nope", deviceKey: "ab".repeat(20) },
      headers: { origin: ORIGIN },
    });
    assert(bad.status() === 401, `錯誤密碼應為 401，實際 ${bad.status()}`);

    await register(naco, "naco", "納可", "貓");
    assert((await naco.evaluate(() => window.office.me.look.head)) === "beanie", "毛帽沒有存下來");
    await naco.locator("#clock-btn").click();
    await naco.getByRole("heading", { name: "要下班了嗎？" }).waitFor();
    await shot(naco, "desktop-clock-out");
    await naco.getByRole("button", { name: "取消" }).click();
    await naco.locator("#clockout").waitFor({ state: "hidden" });
    assert((await naco.evaluate(() => window.office.ready)) === true, "取消下班不該登出");
    await pairSecondDevice(browser, naco, admin);
    await migrateLegacy(browser);

    await momo.goto(`${ORIGIN}/`);
    await momo.getByLabel("辦公室密碼").fill(PASS);
    await momo.getByRole("button", { name: "進入", exact: true }).click();
    await momo.getByLabel("你的 ID").fill("x");
    await momo.locator("#office-name").fill("測試");
    await momo.getByRole("button", { name: "下一步" }).click();
    await momo.getByText("2 到 16").waitFor();
    await momo.getByLabel("你的 ID").fill("naco");
    await momo.getByRole("button", { name: "下一步" }).click();
    await momo.getByText("已經有人使用").waitFor();
    await momo.getByLabel("你的 ID").fill("momo");
    await momo.locator("#office-name").fill("茉茉");
    await momo.getByRole("button", { name: "下一步" }).click();
    await momo.getByRole("button", { name: "兔", exact: true }).click();
    await momo.getByRole("button", { name: "進入辦公室" }).click();
    await ready(momo);
    await naco.waitForFunction(() => window.office.others.some((person) => person.id === "momo"));
    await momo.waitForFunction(() => window.office.others.some((person) => person.id === "naco"));
    const spawnGap = await naco.evaluate(() => {
      const other = window.office.others.find((person) => person.id === "momo");
      return Math.hypot(window.office.me.x - other.x, window.office.me.y - other.y);
    });
    assert(spawnGap >= 64, `兩位玩家不該出生在同一個點，距離 ${spawnGap}`);
    await shot(naco, "office-two-players");
    assert((await naco.evaluate(() => window.office.view3d)) === true, "辦公室應該用 WebGL 畫出來");
    assert((await naco.evaluate(() => window.office.cameraMode)) === "iso", "預設應該是俯瞰鏡頭");
    await settleView(naco);
    await naco.waitForTimeout(1200);
    await shot(naco, "office-iso");
    await shot(naco, "desktop-office");
    await shot(naco, "header-desktop");
    assert(await naco.locator("#clock-btn").isVisible(), "桌面頂欄要有下班");
    assert(await naco.locator("#clock-drawer").isHidden(), "桌面在線面板不該再有下班");
    assert(await naco.locator("#rename").isVisible(), "桌面在線面板要留改名稱");
    assert(await naco.getByRole("button", { name: "下班" }).count() === 1, "下班只能出現一次");
    const isoDist = await naco.evaluate(() => window.office.cameraDist);
    const isoYaw = await naco.evaluate(() => window.office.cameraYaw);
    for (const dist of [420, 980]) {
      await naco.evaluate((dist) => window.office.setView({ dist }), dist);
      await settleView(naco);
      assertLabel(await readLabel(naco, "naco"), `俯瞰 ${dist} `);
    }
    await naco.evaluate(({ yaw, dist }) => window.office.setView({ yaw, dist }), { yaw: isoYaw, dist: isoDist });
    await settleView(naco);
    await naco.getByRole("button", { name: "跟隨" }).click();
    await naco.waitForFunction(() => window.office.cameraMode === "follow");
    await settleView(naco);
    assertLabel(await readLabel(naco, "naco"), "跟隨 ");
    await naco.getByRole("button", { name: "俯瞰" }).click();
    await naco.waitForFunction(() => window.office.cameraMode === "iso");
    await settleView(naco);

    await dragCamera(naco, momo, "naco");

    await march(momo, 614, 560);
    await march(naco, 860, 560);
    const cast = [
      { id: "foxie", name: "小狐", animal: "fox", x: 696, y: 560 },
      { id: "doggo", name: "小狗", animal: "dog", x: 778, y: 560 },
      { id: "beary", name: "小熊", animal: "bear", x: 942, y: 560 },
      { id: "pandy", name: "圓圓", animal: "panda", x: 1024, y: 560 },
      { id: "penny", name: "企企", animal: "penguin", x: 1106, y: 560 },
      { id: "froggy", name: "青青", animal: "frog", x: 1188, y: 560 },
    ];
    await naco.evaluate((people) => window.office.poseCast(people), cast);
    await naco.evaluate(() => window.office.setView({ dist: 800 }));
    await settleView(naco);
    await naco.waitForTimeout(1200);
    await shot(naco, "office-animals");
    await naco.evaluate(() => window.office.setView({ dist: 980 }));
    await settleView(naco);
    await naco.waitForTimeout(400);
    await assetsReady(naco).catch(() => {});
    await naco.waitForTimeout(400);
    await shot(naco, "style-desktop-office");
    await shot(naco, "style2-desktop-office");
    await shot(naco, "style3-desktop-office");
    await naco.evaluate((ids) => window.office.clearCast(ids), cast.map((person) => person.id));
    const styleHome = await naco.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
    await naco.evaluate(() => window.office.place(31 * 32 + 16, 5 * 32));
    await naco.evaluate(() => window.office.setView({ dist: 720 }));
    await settleView(naco);
    await naco.waitForTimeout(500);
    await shot(naco, "style-game-room");
    await shot(naco, "style2-game-room");
    await naco.evaluate(() => {
      window.office.place(33 * 32 + 8, 28 * 32);
      window.office.setView({ dist: 620 });
    });
    await settleView(naco);
    await naco.waitForTimeout(500);
    await shot(naco, "style2-lounge");
    await naco.evaluate((spot) => {
      window.office.place(spot.x, spot.y);
      window.office.setView({ dist: spot.dist });
    }, { ...styleHome, dist: isoDist });
    await settleView(naco);

    const customHome = await naco.evaluate(() => ({
      x: window.office.me.x,
      y: window.office.me.y,
      look: window.office.me.look,
      animal: window.office.me.animal,
    }));
    const momoHome = await momo.evaluate(() => ({ x: window.office.me.x, y: window.office.me.y }));
    const colors = (body, extra = {}) => ({
      body,
      ear: extra.ear || body,
      inner: extra.inner || "#ffffff",
      tip: extra.tip || "#4a1c0c",
      belly: extra.belly || "#fffdfb",
      tail: extra.tail || body,
      blush: extra.blush || "#ff709c",
    });
    const custom = (partial) => ({
      v: 2,
      body: "bean",
      ears: "none",
      tail: "none",
      belly: true,
      eyes: "highlight",
      mouth: "omega",
      blush: "oval",
      marking: "none",
      head: "none",
      face: "none",
      neck: "none",
      held: "none",
      ...partial,
      colors: colors(partial.colors?.body || "#f06292", partial.colors || {}),
    });
    const lineup = [
      custom({ body: "pear", ears: "fox", tail: "bush", head: "flower", mouth: "omega", colors: colors("#f06a28", { inner: "#ff7a62", tip: "#4a1c0c", tail: "#f06a28", belly: "#fff1e4" }) }),
      custom({ body: "wide", ears: "long", tail: "puff", head: "ribbon", eyes: "sparkle", colors: colors("#fff8fc", { ear: "#f7c2d8", inner: "#d45388", tail: "#fffdfb" }) }),
      custom({ body: "mochi", ears: "flop", tail: "curl", eyes: "sleepy", mouth: "smile", neck: "scarf", colors: colors("#e0a045", { ear: "#b56a32", inner: "#f6d7b0", tail: "#b56a32", belly: "#fff0d0" }) }),
      custom({ body: "bean", ears: "round", tail: "nub", belly: false, marking: "panda", blush: "none", mouth: "smile", colors: colors("#fffdfb", { ear: "#1a1a22", inner: "#3a3544", tip: "#1a1a22" }) }),
      custom({ body: "bean", ears: "none", tail: "none", mouth: "beak", blush: "none", face: "sun", head: "crown", colors: colors("#243356", { belly: "#fffdfb", inner: "#f0a050" }) }),
      custom({ body: "wide", ears: "nub", tail: "thin", eyes: "happy", mouth: "wide", blush: "lines", marking: "freckles", held: "balloon", colors: colors("#3cb85c", { belly: "#dff5b0", tail: "#2e8b46", blush: "#ff709c" }) }),
    ];
    const spots = [600, 720, 840, 960, 1080, 1200];
    await momo.evaluate(() => window.office.place(48, 48));
    await naco.evaluate((x) => window.office.place(x, 560), spots[2]);
    await naco.evaluate((look) => window.office.applyLook(look, "custom"), lineup[2]);
    await naco.evaluate((people) => window.office.poseCast(people), lineup.map((look, index) => ({
      id: `custom-${index}`,
      name: `造型${index + 1}`,
      animal: "custom",
      look,
      x: spots[index],
      y: 560,
    })).filter((_, index) => index !== 2));
    await naco.evaluate(() => window.office.setView({ dist: 980 }));
    await settleView(naco);
    await naco.waitForTimeout(1200);
    await shot(naco, "office-custom");
    await naco.evaluate(() => window.office.clearCast(["custom-0", "custom-1", "custom-3", "custom-4", "custom-5"]));
    await naco.evaluate((savedLook) => window.office.applyLook(savedLook.look, savedLook.animal), customHome);
    await naco.evaluate(({ x, y }) => window.office.place(x, y), customHome);
    await momo.evaluate(({ x, y }) => window.office.place(x, y), momoHome);
    await naco.evaluate(({ yaw, dist }) => window.office.setView({ yaw, dist }), { yaw: isoYaw, dist: isoDist });
    await settleView(naco);
    await naco.getByRole("button", { name: "跟隨" }).click();
    await naco.waitForFunction(() => window.office.cameraMode === "follow");
    assert((await naco.evaluate(() => window.office.cameraMode)) === "follow", "按鈕應該切到跟隨鏡頭");
    await settleView(naco);
    await shot(naco, "office-follow");
    await naco.keyboard.press("v");
    await naco.waitForFunction(() => window.office.cameraMode === "iso");
    await settleView(naco);

    await naco.evaluate(() => window.office.place(620, 560));
    await momo.evaluate(() => window.office.place(900, 560));
    await naco.waitForFunction(() => {
      const other = window.office.others.find((person) => person.id === "momo");
      return other && Math.hypot(other.x - 900, other.y - 560) < 48;
    });
    await naco.evaluate(() => {
      const other = window.office.others.find((person) => person.id === "momo");
      window.office.walkTo(other.x, other.y);
    });
    await momo.evaluate(() => {
      const other = window.office.others.find((person) => person.id === "naco");
      window.office.walkTo(other.x, other.y);
    });
    const push = await naco.evaluate(async () => {
      let min = Infinity;
      let minGap = Infinity;
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        const other = window.office.others.find((person) => person.id === "momo");
        min = Math.min(min, Math.hypot(window.office.me.x - other.x, window.office.me.y - other.y));
        const gap = window.office.gap("momo");
        if (typeof gap === "number") minGap = Math.min(minGap, gap);
      }
      const other = window.office.others.find((person) => person.id === "momo");
      return {
        min,
        minGap,
        sum: window.office.radius(window.office.me.look) + window.office.radius(other.look),
      };
    });
    assert(push.min >= push.sum - 14, `兩人擠在一起時重疊了，距離 ${push.min.toFixed(1)}，半徑和 ${push.sum}`);
    assert(push.minGap >= push.sum - 8, `畫面上還是疊在一起，距離 ${push.minGap.toFixed(1)}，半徑和 ${push.sum}`);

    await momo.evaluate(() => window.office.place(180, 200));
    await naco.evaluate(() => window.office.place(720, 560));
    const bunch = ["fox", "rabbit", "panda", "frog", "dog"].map((animal, index) => ({
      id: `bunch-${index}`,
      name: `擠${index + 1}`,
      animal,
      x: 720 + (index - 2) * 6,
      y: 560,
    }));
    await naco.evaluate((people) => window.office.poseCast(people), bunch);
    await naco.evaluate(() => window.office.setView({ dist: 760 }));
    await settleView(naco);
    await naco.waitForTimeout(900);
    await shot(naco, "office-bunch");
    await naco.evaluate((ids) => window.office.clearCast(ids), bunch.map((person) => person.id));
    await naco.evaluate(({ yaw, dist }) => window.office.setView({ yaw, dist }), { yaw: isoYaw, dist: isoDist });
    await settleView(naco);

    const chairs = await naco.evaluate(() => window.office.furniture
      .filter((item) => item.kind === "chair" && item.id.startsWith("desk-"))
      .slice(0, 2)
      .map((item) => ({ id: item.id, x: item.x + 16, y: item.y + 13 })));
    await naco.evaluate((spot) => window.office.place(spot.x, spot.y), chairs[0]);
    await naco.waitForTimeout(200);
    await naco.keyboard.press("e");
    await naco.waitForFunction((id) => window.office.seat === id, chairs[0].id);
    await momo.waitForFunction((id) => window.office.others.some((person) => person.id === "naco" && person.seat === id), chairs[0].id);
    const beforeGlide = await momo.evaluate(() => window.office.others.find((person) => person.id === "naco").x);
    await naco.evaluate(() => window.office.drive(1, 0));
    await naco.waitForTimeout(800);
    await naco.evaluate(() => window.office.drive(0, 0));
    await naco.waitForFunction((id) => {
      const item = window.office.furniture.find((entry) => entry.id === id);
      return item && (item.speed || 0) < 1;
    }, chairs[0].id);
    const afterGlide = await naco.evaluate((id) => window.office.furniture.find((item) => item.id === id).x, chairs[0].id);
    assert(afterGlide > chairs[0].x - 4, `椅子沒有滑出去，x=${afterGlide}，中心 ${chairs[0].x}`);
    await momo.waitForFunction((start) => {
      const person = window.office.others.find((item) => item.id === "naco");
      return person && person.x > start + 12;
    }, beforeGlide);
    await momo.evaluate((spot) => window.office.place(spot.x, spot.y), chairs[1]);
    await momo.waitForTimeout(200);
    await momo.keyboard.press("e");
    await momo.waitForFunction((id) => window.office.seat === id, chairs[1].id);
    await naco.evaluate(() => window.office.setView({ dist: 980 }));
    await settleView(naco);
    await naco.waitForTimeout(400);
    await shot(naco, "office-chairs");
    const parked = await naco.evaluate((id) => window.office.furniture.find((item) => item.id === id).x, chairs[0].id);
    await naco.keyboard.press("e");
    await momo.keyboard.press("e");
    await naco.waitForFunction(() => !window.office.seat);
    await momo.waitForFunction(() => !window.office.seat);
    await momo.waitForFunction(() => window.office.others.some((person) => person.id === "naco" && !person.seat));
    const stayed = await naco.evaluate((id) => window.office.furniture.find((item) => item.id === id).x, chairs[0].id);
    assert(Math.abs(stayed - parked) < 6, `起立後椅子應留在原地，${parked} -> ${stayed}`);
    await naco.evaluate(({ yaw, dist }) => window.office.setView({ yaw, dist }), { yaw: isoYaw, dist: isoDist });
    await settleView(naco);

    await admin.getByText("在線", { exact: true }).first().waitFor();
    await admin.locator('tr[data-id="naco"]').getByText("在線").waitFor();
    await admin.locator('tr[data-id="momo"]').getByText("在線").waitFor();
    await shot(admin, "admin-online");

    await naco.locator(".brand").click();
    const before = await momo.evaluate(() => window.office.others.find((person) => person.id === "naco").x);
    await naco.keyboard.down("ArrowRight");
    await naco.waitForTimeout(1500);
    await naco.keyboard.up("ArrowRight");
    await momo.waitForFunction((start) => {
      const person = window.office.others.find((item) => item.id === "naco");
      return person && (person.x > start + 25 || (person.tx ?? 0) > start + 25);
    }, before);

    const clickTarget = await naco.evaluate(() => {
      const me = window.office.me;
      return { before: me.x, point: window.office.worldToScreen(me.x + 150, me.y + 40) };
    });
    await naco.mouse.click(clickTarget.point.x, clickTarget.point.y);
    await naco.waitForFunction((start) => Math.hypot(window.office.me.x - start, window.office.me.y) > 36 || window.office.me.x > start + 30, clickTarget.before);

    await naco.evaluate(() => {
      const input = document.querySelector("#chat-input");
      input.focus();
      input.value = "選字中";
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const composing = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(composing, "isComposing", { get: () => true });
      Object.defineProperty(composing, "keyCode", { get: () => 229 });
      input.dispatchEvent(composing);
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      const confirmEnter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      input.dispatchEvent(confirmEnter);
      document.querySelector("#chatbar").requestSubmit();
    });
    await naco.waitForTimeout(40);
    assert((await naco.locator("#chat-input").inputValue()) === "選字中", "選字時的 Enter 不該送出");
    assert(!(await naco.evaluate(() => window.office.bubbles.some((bubble) => bubble.text.includes("選字")))), "選字內容不該變成泡泡");

    await naco.locator("#chat-input").fill("午安");
    await naco.locator("#chat-input").press("Enter");
    await momo.waitForFunction(() => window.office.bubbles.some((bubble) => bubble.id === "naco" && bubble.text.includes("午安")));
    const shortLife = await naco.evaluate(() => {
      const bubble = window.office.bubbles.find((item) => item.id === "naco" && item.text.includes("午安"));
      return bubble ? bubble.until - performance.now() : -1;
    });
    assert(shortLife > 5200 && shortLife < 7200, `短句泡泡時間不對 ${shortLife}`);
    const longer = "這是一段比較長的話用來確認泡泡會留久一點";
    await naco.locator("#chat-input").fill(longer);
    await naco.locator("#chat-input").press("Enter");
    await naco.waitForFunction((text) => {
      const mine = window.office.bubbles.filter((item) => item.id === "naco");
      return mine.length === 1 && mine[0].text === text;
    }, longer);
    const longLife = await naco.evaluate((text) => {
      const bubble = window.office.bubbles.find((item) => item.id === "naco");
      const expect = Math.min(15000, 6000 + [...text].length * 250);
      return { left: bubble ? bubble.until - performance.now() : -1, expect };
    }, longer);
    assert(longLife.left > 9000 && Math.abs(longLife.left - longLife.expect) < 1200, `長句泡泡時間不對 ${JSON.stringify(longLife)}`);
    await shot(momo, "chat-bubble");
    await naco.getByRole("button", { name: "跟隨" }).click();
    await naco.waitForFunction(() => window.office.cameraMode === "follow");
    await settleView(naco);
    assertLabel(await readLabel(naco, "naco"), "跟隨泡泡 ");
    await shot(naco, "label-desktop");
    await naco.getByRole("button", { name: "俯瞰" }).click();
    await naco.waitForFunction(() => window.office.cameraMode === "iso");
    await settleView(naco);

    const hanaContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const hana = await hanaContext.newPage();
    hana.on("pageerror", (error) => console.log("PAGE", error.message));
    hana.on("console", (msg) => {
      if (msg.type() === "error") console.log("CONSOLE", msg.text());
    });
    await register(hana, "hana", "花", "狗");
    await naco.evaluate(() => window.office.place(640, 340));
    await momo.evaluate(() => window.office.place(730, 340));
    await march(hana, 900, 340);
    await naco.waitForFunction(() => {
      const other = window.office.others.find((person) => person.id === "momo");
      return other && Math.hypot(window.office.me.x - other.x, window.office.me.y - other.y) < 112;
    });
    await naco.waitForFunction(() => document.querySelector("#hint").textContent.includes("按 F 跟 @momo 說悄悄話"));
    await naco.locator("#chat-input").blur();
    await naco.keyboard.press("f");
    await naco.waitForFunction(() => window.office.group.includes("momo") && window.office.group.includes("naco") && window.office.group.length === 2);
    await momo.waitForFunction(() => window.office.group.includes("naco") && window.office.group.length === 2);
    await momo.waitForFunction(() => document.querySelector("#hint").textContent.includes("@naco") && document.querySelector("#hint").textContent.includes("悄悄話"));
    await naco.waitForFunction(() => {
      const label = document.querySelector("#chat-whisper-label");
      const list = document.querySelector("#chat-whisper-list");
      return label && label.textContent === "悄悄話（2 人）" && list.textContent.includes("@momo") && list.textContent.includes("@naco");
    });
    await naco.locator("#chat-input").focus();
    await naco.keyboard.press("f");
    assert((await naco.evaluate(() => window.office.group.includes("momo"))) , "打字時按 F 不該離開悄悄話");
    await naco.locator("#chat-input").fill("秘密桃子");
    await naco.locator("#chat-input").press("Enter");
    await momo.waitForFunction(() => window.office.bubbles.some((bubble) => bubble.whisper && bubble.text.includes("秘密桃子")));
    const whisperLife = await naco.evaluate(() => {
      const bubble = window.office.bubbles.find((item) => item.whisper && item.text.includes("秘密桃子"));
      return bubble ? bubble.until - performance.now() : -1;
    });
    assert(whisperLife > 5000, `悄悄話泡泡太快 ${whisperLife}`);
    await momo.waitForFunction(() => {
      const node = document.querySelector('.floater[data-id="naco"] .bubble');
      return node && node.classList.contains("whisper") && node.textContent.includes("秘密桃子");
    });
    await hana.waitForFunction(() => {
      const mine = document.querySelector('.floater[data-id="naco"] .bubble');
      const hers = document.querySelector('.floater[data-id="momo"] .bubble');
      return mine && hers && mine.classList.contains("secret") && hers.classList.contains("secret") && mine.textContent.includes("對話中") && hers.textContent.includes("對話中");
    });
    const leaked = await hana.evaluate(() => window.office.tape.some((item) => JSON.stringify(item).includes("秘密桃子")) || window.office.bubbles.some((bubble) => bubble.text.includes("秘密桃子")));
    assert(!leaked, "旁觀者不該收到悄悄話內容");
    await momo.evaluate(() => window.office.setView({ dist: 860 }));
    await momo.waitForTimeout(350);
    await shot(momo, "whisper-participant");
    await hana.evaluate(() => window.office.setView({ dist: 1100 }));
    await hana.waitForTimeout(350);
    await shot(hana, "whisper-outsider");
    const joinSpot = await hana.evaluate(() => {
      const partner = window.office.others.find((person) => person.id === "momo") || window.office.others.find((person) => person.id === "naco");
      return { x: partner.x + 64, y: partner.y };
    });
    await march(hana, joinSpot.x, joinSpot.y);
    await hana.waitForFunction(() => document.querySelector("#hint").textContent.includes("想加入"));
    await hana.locator("#chat-input").blur();
    await hana.keyboard.press("f");
    await naco.waitForFunction(() => window.office.asks.some((ask) => ask.id === "hana"));
    await momo.waitForFunction(() => window.office.asks.some((ask) => ask.id === "hana"));
    await naco.getByRole("button", { name: "婉拒" }).click();
    await naco.waitForFunction(() => !window.office.asks.some((ask) => ask.id === "hana"));
    assert(!(await hana.evaluate(() => window.office.group.includes("hana"))), "婉拒不該把人加進悄悄話");
    await momo.getByRole("button", { name: "答應" }).click();
    await hana.waitForFunction(() => window.office.group.includes("hana") && window.office.group.length === 3);
    await naco.waitForFunction(() => window.office.group.length === 3);
    await naco.locator("#chat-input").fill("圈內第二句");
    await naco.locator("#chat-input").press("Enter");
    await hana.waitForFunction(() => window.office.bubbles.some((bubble) => bubble.whisper && bubble.text.includes("圈內第二句")));
    const away = await hana.evaluate(() => {
      const partner = window.office.others.find((person) => person.id === "momo");
      const x = partner.x + 420 > 1180 ? partner.x - 420 : partner.x + 420;
      return { x, y: partner.y };
    });
    await march(hana, away.x, away.y);
    await hana.waitForFunction(() => !window.office.whisper);
    await naco.waitForFunction(() => {
      const group = window.office.group;
      return group.includes("naco") && group.includes("momo") && !group.includes("hana") && group.length === 2;
    });
    const split = await momo.evaluate(() => {
      const partner = window.office.others.find((person) => person.id === "naco");
      const west = { x: 96, y: partner.y };
      const east = { x: 480, y: partner.y };
      const clear = (spot) => Math.hypot(spot.x - partner.x, spot.y - partner.y) > 220 && spot.x > 64 && spot.x < 520;
      if (clear(west)) return west;
      return east;
    });
    await march(momo, split.x, split.y);
    await naco.waitForFunction(() => !window.office.whisper);
    await momo.waitForFunction(() => !window.office.whisper);
    await hana.close();
    await hanaContext.close();
    await naco.evaluate(({ yaw, dist }) => window.office.setView({ yaw, dist }), { yaw: isoYaw, dist: isoDist });
    await momo.evaluate(({ yaw, dist }) => window.office.setView({ yaw, dist }), { yaw: isoYaw, dist: isoDist });

    await naco.evaluate(() => window.office.socket.close());
    await naco.waitForFunction(() => document.querySelector("#conn").textContent.includes("重新連線"));
    await naco.waitForFunction(() => document.querySelector("#conn").textContent.includes("已連線"), null, { timeout: 10000 });

    const blocked = await naco.evaluate(async () => (await window.office.ask("setup", { animal: "fox" })).status);
    assert(blocked === 403, `辦公室裡不該能直接換造型，狀態 ${blocked}`);

    await clickWalk(naco, 176, 880);
    await naco.waitForFunction(() => window.office.zone === "男廁", null, { timeout: 8000 });
    await naco.waitForTimeout(300);
    await naco.keyboard.press("e");
    await naco.getByRole("heading", { name: "廁所鏡子" }).waitFor();
    await naco.getByRole("button", { name: "貓熊", exact: true }).click();
    await shot(naco, "restroom-avatar");
    await naco.getByRole("button", { name: "換上這個造型" }).click();
    await naco.locator("#avatar").waitFor({ state: "hidden" });
    await momo.waitForFunction(() => window.office.others.some((person) => person.id === "naco" && person.animal === "panda"));

    await clickWalk(naco, 224, 208);
    await naco.waitForFunction(() => {
      const me = window.office.me;
      return Math.hypot(me.x - 224, me.y - 208) < 36;
    });
    await naco.waitForTimeout(350);
    await naco.keyboard.press("e");
    await naco.getByRole("button", { name: "調整設備擺設" }).click();
    await naco.waitForFunction(() => window.office.editing);
    await editFurniture(naco, { touch: false, witness: momo, shotName: "edit-desktop", leave: false });
    await naco.getByRole("button", { name: "辦公區" }).click();
    await naco.evaluate(() => {
      const item = window.office.furniture.find((furn) => furn.id === "desk-1-monitor");
      window.office.focusOn(item.x + 18, item.y + 12);
    });
    await naco.waitForFunction(() => {
      const item = window.office.furniture.find((furn) => furn.id === "desk-1-monitor");
      const point = window.office.worldToScreen(item.x + 18, item.y + 12);
      const dest = window.office.worldToScreen(item.x + 18 + 36, item.y + 12);
      const bar = document.getElementById("editbar").getBoundingClientRect().bottom;
      const onScreen = (spot) => spot.x > 40 && spot.x < 1380 && spot.y > bar + 8 && spot.y < 860;
      const prev = window.__furnStable;
      window.__furnStable = { x: point.x, y: point.y, dx: dest.x, dy: dest.y };
      if (!prev) return false;
      const still = Math.hypot(point.x - prev.x, point.y - prev.y) < 0.4
        && Math.hypot(dest.x - prev.dx, dest.y - prev.dy) < 0.4;
      return still && onScreen(point) && onScreen(dest);
    });
    const origin = await naco.evaluate(() => {
      const item = window.office.furniture.find((furn) => furn.id === "desk-1-monitor");
      return {
        x: item.x,
        y: item.y,
        point: window.office.worldToScreen(item.x + 18, item.y + 12),
        dest: window.office.worldToScreen(item.x + 18 + 36, item.y + 12),
      };
    });
    await naco.mouse.move(origin.point.x, origin.point.y);
    await naco.mouse.down();
    await naco.mouse.move(origin.dest.x, origin.dest.y, { steps: 8 });
    await naco.mouse.up();
    await momo.waitForFunction((start) => {
      const item = window.office.furniture.find((furn) => furn.id === "desk-1-monitor");
      return item && Math.hypot(item.x - start.x, item.y - start.y) > 24;
    }, origin);
    await shot(naco, "edit-furniture");
    const movedFurn = await momo.evaluate(() => window.office.furniture.find((furn) => furn.id === "desk-1-monitor"));
    await naco.reload();
    await ready(naco);
    const afterReload = await naco.evaluate(() => window.office.furniture.find((furn) => furn.id === "desk-1-monitor"));
    assert(Math.abs(afterReload.x - movedFurn.x) < 1.5 && Math.abs(afterReload.y - movedFurn.y) < 1.5, "重新整理後螢幕位置不一樣");
    assert(afterReload.x !== origin.x || afterReload.y !== origin.y, "螢幕沒有被搬動");
    await shot(naco, "furniture-persisted");
    const deskCount = await naco.evaluate(() => window.office.furniture.filter((item) => item.kind === "monitor").length);
    assert(deskCount === 10, `螢幕應該有 10 個，實際 ${deskCount}`);

    const anonScore = await fetch(`${ORIGIN}/api/office/score`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ game: "zip", op: "solve" }),
    });
    assert(anonScore.status === 404, `記分已改走連線，HTTP 應為 404，實際 ${anonScore.status}`);
    const huge = await naco.evaluate(async () => (await window.office.ask("score", { game: "cat2048", score: 999999999 })).status);
    assert(huge === 400, `過大的分數應為 400，實際 ${huge}`);

    await walkTo(naco, 962, 156);
    await naco.keyboard.press("e");
    await naco.locator("#arcade").waitFor({ state: "visible" });
    await naco.waitForFunction(() => {
      const frame = document.querySelector("#arcade-frame");
      return frame && frame.contentDocument && frame.contentDocument.querySelector("h1");
    });
    const gamesFrame = naco.frames().find((frame) => frame.url().includes("/games"));
    assert(gamesFrame, "街機沒有打開大廳");
    await gamesFrame.getByRole("heading", { name: "小遊戲大廳" }).waitFor();
    await gamesFrame.getByRole("button", { name: "回到辦公室" }).waitFor();
    assert((await naco.evaluate(() => window.office.connected)) === true, "玩遊戲時連線不該斷");
    await gamesFrame.evaluate(() => {
      const child = document.createElement("iframe");
      child.srcdoc = "<script>parent.postMessage({officeSolve:'zip'},'*')</script>";
      document.body.appendChild(child);
    });
    await naco.waitForFunction(async () => {
      const data = await window.office.ask("leaderboard");
      const zip = (data.games || []).find((game) => game.id === "zip");
      return Boolean(zip && zip.me && zip.me.score >= 1);
    });
    await naco.locator("#arcade-close").click();
    await naco.locator("#arcade").waitFor({ state: "hidden" });
    assert((await naco.evaluate(() => window.office.connected && !window.office.arcade)) === true, "關掉街機後應該還在辦公室");
    await naco.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "e" }));
    });
    await naco.locator("#arcade").waitFor({ state: "visible" });
    await naco.waitForFunction(() => {
      const frame = document.querySelector("#arcade-frame");
      return frame && frame.contentDocument && frame.contentDocument.querySelector(".office-close");
    });
    const reopened = naco.frames().find((frame) => frame.url().includes("/games"));
    await reopened.getByRole("button", { name: "回到辦公室" }).click();
    await naco.locator("#arcade").waitFor({ state: "hidden" });
    assert((await naco.evaluate(() => window.office.connected && !window.office.arcade)) === true, "從大廳回到辦公室後應該還在線");

    await walkTo(naco, 1064, 240);
    await naco.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "e" }));
    });
    await naco.getByRole("heading", { name: "排行榜" }).waitFor();
    await naco.getByRole("button", { name: "Zip", exact: true }).click();
    await naco.locator("#board-list .me").waitFor();
    await naco.locator("#board-list").getByText("@naco").waitFor();
    await naco.locator("#board-close").click();

    await admin.locator('tr[data-id="momo"] button', { hasText: "踢出" }).click();
    await momo.getByText("請出辦公室").waitFor();
    await momo.getByLabel("辦公室密碼").fill(PASS);
    await momo.getByRole("button", { name: "進入", exact: true }).click();
    await ready(momo);
    assert((await momo.evaluate(() => window.office.me.id)) === "momo", "踢出後應該回到原來的 ID");

    await admin.getByLabel("新的辦公室密碼").fill(PASS2);
    await admin.getByLabel("再輸入一次").fill(PASS2);
    await admin.getByRole("button", { name: "儲存新密碼" }).click();
    await naco.getByText("密碼已更新").waitFor();
    await naco.getByLabel("辦公室密碼").fill(PASS);
    await naco.getByRole("button", { name: "進入", exact: true }).click();
    await naco.getByText("密碼不正確").waitFor();
    await naco.getByLabel("辦公室密碼").fill(PASS2);
    await naco.getByRole("button", { name: "進入", exact: true }).click();
    await ready(naco);
    assert((await naco.locator("#form-register").isHidden()) === true, "舊裝置不該重填 ID");
    assert((await naco.evaluate(() => window.office.me.id)) === "naco", "換密碼後 ID 不對");
    assert((await naco.evaluate(() => window.office.me.animal)) === "panda", "換密碼後造型不見了");

    const fresh = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const mika = await fresh.newPage();
    await mika.goto(`${ORIGIN}/`);
    await mika.getByLabel("辦公室密碼").fill(PASS2);
    await mika.getByRole("button", { name: "進入", exact: true }).click();
    await mika.getByLabel("你的 ID").fill("naco");
    await mika.locator("#office-name").fill("別人");
    await mika.getByRole("button", { name: "下一步" }).click();
    await mika.getByText("已經有人使用").waitFor();
    await mika.getByLabel("你的 ID").fill("mika");
    await mika.locator("#office-name").fill("米卡");
    await mika.getByRole("button", { name: "下一步" }).click();
    await mika.getByRole("button", { name: "狐", exact: true }).click();
    await mika.getByRole("button", { name: "進入辦公室" }).click();
    await ready(mika);
    await admin.goto(`${ORIGIN}${PANEL}`);
    await admin.getByLabel("密碼", { exact: true }).fill(ADMIN);
    await admin.getByRole("button", { name: "進入", exact: true }).click();
    await admin.locator("#pw-state").waitFor();
    await admin.locator('tr[data-id="mika"]').waitFor();
    await admin.locator('tr[data-id="mika"] button', { hasText: "移除" }).click();
    await mika.getByText("已被管理員移除").waitFor();

    if (SHARD !== "desk") {
      await mobileOffice(browser, PASS2);
      await toyRoom(browser);
    }

    publishShots();
    console.log("e2e ok");
  } finally {
    await browser?.close();
    stopChild(proc);
    rmSync(RUN, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
