import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const root = join(import.meta.dirname, "..", "public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp" };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function serve() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^\//, "");
    if (path === "" || path === ".") path = "index.html";
    if (path === "games" || path === "games/") path = "games/index.html";
    const file = join(root, path);
    if (!file.startsWith(root)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function show(page, id) {
  await page.evaluate((next) => {
    location.hash = `#${next}`;
  }, id);
  await page.locator("#gname", { hasText: id === "cat2048" ? "2048" : id === "match3" ? "皇家" : id === "bbq" ? "燒肉" : id === "queens" ? "Queens" : id === "sudoku" ? "Sudoku" : id === "patches" ? "Patches" : "Zip" }).waitFor();
  await page.locator(`#f-${id}`).waitFor();
}

async function main() {
  const { server, origin } = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    await page.goto(`${origin}/games`);
    await page.evaluate(() => {
      localStorage.setItem("lobby_cat2048", JSON.stringify({ best: 128, max: 128 }));
      localStorage.removeItem("cat2048");
      localStorage.setItem("lobby_m3", JSON.stringify({ unlocked: 4, stars: [3, 1, 0] }));
      localStorage.removeItem("royalMatch3");
      localStorage.setItem("yakiniku_best_v1", "2500");
    });

    await show(page, "cat2048");
    await page.waitForFunction(() => document.querySelector("#f-cat2048")?.contentDocument?.querySelector("#best")?.textContent === "128");
    await show(page, "zip");
    assert((await page.locator("#f-cat2048").count()) === 0, "離開後不該留下貓咪場");
    await show(page, "cat2048");
    await page.waitForFunction(() => document.querySelector("#f-cat2048")?.contentDocument?.querySelector("#best")?.textContent === "128");

    await show(page, "match3");
    await page.waitForFunction(() => document.querySelector("#f-match3")?.contentDocument?.querySelectorAll("#map .lv:not(.locked)").length === 4);
    await show(page, "queens");
    assert((await page.locator("#f-match3").count()) === 0, "離開後不該留下消消樂場");
    await show(page, "match3");
    await page.waitForFunction(() => document.querySelector("#f-match3")?.contentDocument?.querySelectorAll("#map .lv:not(.locked)").length === 4);

    await show(page, "bbq");
    await page.waitForFunction(() => (document.querySelector("#f-bbq")?.contentDocument?.querySelector("#bestLine")?.textContent || "").includes("2500"));
    await page.evaluate(() => { document.querySelector("#f-bbq").contentWindow.__round = "live"; });
    await show(page, "zip");
    assert((await page.locator("#f-bbq").count()) === 1, "切走後燒肉這局應該留著");
    await show(page, "bbq");
    assert((await page.evaluate(() => document.querySelector("#f-bbq").contentWindow.__round)) === "live", "回來後燒肉這局不見了");
    await page.waitForFunction(() => (document.querySelector("#f-bbq")?.contentDocument?.querySelector("#bestLine")?.textContent || "").includes("2500"));

    await show(page, "zip");
    const zip = page.frameLocator("#f-zip");
    await zip.locator("#size").selectOption("5");
    await show(page, "queens");
    assert((await page.locator("#f-zip").count()) === 1, "連線題目應該留在原畫面");
    await show(page, "zip");
    assert((await zip.locator("#size").inputValue()) === "5", "回來後連線題目不該重來");

    const queens = page.frameLocator("#f-queens");
    await show(page, "queens");
    await queens.locator("#size").selectOption("8");
    await queens.locator(".cell").first().click();
    const mark = await queens.locator(".cell").first().innerHTML();
    assert(mark.includes("svg"), "貓掌沒有標上記號");
    await show(page, "sudoku");
    assert((await page.locator("#f-queens").count()) === 1, "貓掌題目應該留在原畫面");
    await show(page, "queens");
    assert((await queens.locator("#size").inputValue()) === "8", "回來後貓掌大小不對");
    assert((await queens.locator(".cell").first().innerHTML()) === mark, "回來後貓掌記號不見了");

    const sudoku = page.frameLocator("#f-sudoku");
    await show(page, "sudoku");
    await sudoku.locator("#diff").selectOption("2");
    const cell = sudoku.locator(".cell:not(.given)").first();
    await cell.click();
    await sudoku.locator("#pad button", { hasText: "3" }).click();
    const value = await cell.locator(".v").innerText();
    assert(value === "3", "數獨沒有填上數字");
    await show(page, "patches");
    assert((await page.locator("#f-sudoku").count()) === 1, "數獨應該留在原畫面");
    await show(page, "sudoku");
    assert((await sudoku.locator("#diff").inputValue()) === "2", "回來後數獨難度不對");
    assert((await cell.locator(".v").innerText()) === "3", "回來後數獨數字不見了");

    const patches = page.frameLocator("#f-patches");
    await show(page, "patches");
    await patches.locator("#size").selectOption("7");
    const clues = await patches.locator("#clues").innerText();
    assert(clues.length > 0, "拼布沒有題目");
    await show(page, "zip");
    assert((await page.locator("#f-patches").count()) === 1, "拼布應該留在原畫面");
    await show(page, "patches");
    assert((await patches.locator("#size").inputValue()) === "7", "回來後拼布大小不對");
    assert((await patches.locator("#clues").innerText()) === clues, "回來後拼布題目不見了");

    const parent = await browser.newPage();
    await parent.setContent(`<!DOCTYPE html><iframe id="lobby" src="${origin}/games?from=office" style="width:900px;height:800px;border:0"></iframe>`);
    await parent.evaluate(() => {
      window.closes = 0;
      addEventListener("message", (event) => {
        if (event.data && event.data.officeClose) window.closes += 1;
      });
    });
    const lobby = parent.frameLocator("#lobby");
    await lobby.getByRole("heading", { name: "小遊戲大廳" }).waitFor();
    await parent.frame({ url: /\/games/ }).evaluate(() => {
      location.hash = "#zip";
    });
    await lobby.locator("#gname", { hasText: "Zip" }).waitFor();
    await parent.frame({ url: /\/games/ }).evaluate(() => {
      location.hash = "#bbq";
    });
    await lobby.locator("#gname", { hasText: "燒肉" }).waitFor();
    await parent.frame({ url: /\/games/ }).evaluate(() => {
      location.hash = "";
    });
    await lobby.getByRole("heading", { name: "小遊戲大廳" }).waitFor();
    assert((await parent.evaluate(() => window.closes)) === 0, "切換遊戲不該關掉辦公室連線");
    console.log("lobby ok");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
