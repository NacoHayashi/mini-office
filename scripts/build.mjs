/**
 * Rebuild public/games/index.html from games/*.html.
 *
 * The lobby is one self-contained page. Each game is embedded as an iframe
 * srcdoc string inside a <script> block. Strings are JSON-encoded, then every
 * "</" is written as "<\/" so a game's </script> cannot close the lobby script.
 *
 * Card copy, icons, and the parent postMessage storage bridge are reproduced
 * from the original lobby. srcdoc documents share this page's origin, but
 * 皇家消消樂 and 2048 貓咪進化 still mirror progress to the parent because
 * localStorage inside the frame can fail. The bridge stores:
 *   {lobbySave:{key,val}} / {lobbyLoad:key}  ->  localStorage "lobby_"+key
 *       reply: {lobbyData:{key,val}}
 *   {m3save} / {m3load}                      ->  localStorage "lobby_m3"
 *       reply: {m3data}
 *
 * Switching games unloads frames that already saved their progress, so a hidden
 * game is not left running. Zip, Queens, Sudoku, and Patches stay loaded because
 * the current puzzle only exists in that frame. bbq.html is not edited; its frame
 * is removed and the best score it already stored comes back on the next visit.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "../src/games.json" with { type: "json" };
import pkg from "../package.json" with { type: "json" };
import { versionLabel } from "./version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gamesDir = join(root, "games");
const outFile = join(root, "public", "games", "index.html");

/** Lobby order lives in src/games.json. `name` is the in-game header; it defaults to `title`. */
const GAMES = catalog;

function htmlText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** JSON string literal safe to place inside the lobby <script>. */
function srcdocLiteral(html) {
  return JSON.stringify(html).replaceAll("</", "<\\/");
}

function card(game) {
  return (
    `<a class="card" href="#${game.id}">` +
    `<div class="ic" style="${game.iconStyle}">${game.icon}</div>` +
    `<div class="tx"><b>${htmlText(game.title)}</b><span>${htmlText(game.desc)}</span></div>` +
    `<span class="go">開始</span></a>`
  );
}

const known = new Set(GAMES.map((g) => `${g.id}.html`));
const present = readdirSync(gamesDir).filter((name) => name.endsWith(".html"));
const missing = [...known].filter((name) => !present.includes(name));
const extra = present.filter((name) => !known.has(name));
if (missing.length || extra.length) {
  const lines = [];
  if (missing.length) lines.push(`missing games: ${missing.join(", ")}`);
  if (extra.length) lines.push(`not listed in src/games.json: ${extra.join(", ")}`);
  throw new Error(lines.join("\n"));
}

const embedded = GAMES.map((game) => {
  const html = readFileSync(join(gamesDir, `${game.id}.html`), "utf8");
  return `${JSON.stringify(game.id)}: ${srcdocLiteral(html)}`;
}).join(", ");

const names = GAMES.map((game) => {
  return `${JSON.stringify(game.id)}: ${JSON.stringify(game.name ?? game.title)}`;
}).join(", ");

const html = `<!DOCTYPE html><html lang="zh-Hant-TW"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>小遊戲大廳</title>
<style>:root{--r-sm:6px;--r-md:10px;--r-lg:14px}*{box-sizing:border-box}html,body{margin:0;height:100%}body{font-family:-apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif;background:#f4f2ee;color:#1d1d1d}
#lobby{max-width:560px;margin:0 auto;padding:24px 16px}h1{margin:0 0 4px;font-size:28px}.sub{margin:0 0 20px;color:#666}
.card{display:flex;align-items:center;gap:14px;background:#fff;border-radius:var(--r-lg);padding:14px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);text-decoration:none;color:inherit;transition:transform .15s}
.card:active{transform:scale(.98)}.ic{flex:none;width:58px;height:58px;border-radius:var(--r-md);padding:11px}.ic svg{width:100%;height:100%;display:block}
.tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}.tx b{font-size:17px}.tx span{font-size:13px;color:#666}
.go{flex:none;background:#0a66c2;color:#fff;border-radius:var(--r-md);padding:8px 18px;font-weight:600;font-size:15px}
#game{display:none;position:fixed;inset:0;flex-direction:column;background:#f4f2ee}#game.show{display:flex}
.top{flex:none;height:48px;display:flex;align-items:center;gap:10px;padding:0 10px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.top button,.office-close{font:inherit;font-size:15px;padding:6px 14px;border-radius:var(--r-md);border:1.5px solid #0a66c2;background:#fff;color:#0a66c2;cursor:pointer}
#lobby .office-close{margin:0 0 16px}.top .office-close{margin-left:auto}
.top b{font-size:16px}#frames{flex:1;position:relative}iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:none}iframe.on{display:block}
</style></head><body>
<div id="lobby"><h1>🎮 小遊戲大廳</h1><p class="sub">今天想玩哪一款？</p>${GAMES.map(card).join("")}</div>
<div id="game"><div class="top"><button id="back">← 大廳</button><b id="gname"></b></div><div id="frames"></div></div>
<script>
const GAMES={${embedded}};const NAMES={${names}};const frames={};
const FROM_OFFICE=new URLSearchParams(location.search).get('from')==='office';
function leaveOffice(){if(parent!==window){try{parent.postMessage({officeClose:1},location.origin)}catch(e){}return}location.href='/'}
if(FROM_OFFICE){const mk=()=>{const b=document.createElement('button');b.type='button';b.className='office-close';b.textContent='回到辦公室';b.onclick=leaveOffice;return b};
  document.querySelector('#lobby .sub').insertAdjacentElement('afterend',mk());document.querySelector('#game .top').appendChild(mk())}
function relayScore(payload){if(!FROM_OFFICE||parent===window||!payload)return;try{parent.postMessage({officeScore:payload},location.origin)}catch(e){}}
function matchCleared(mem){const stars=mem&&Array.isArray(mem.stars)?mem.stars:[];let n=0;stars.forEach((s,i)=>{if(s>0)n=Math.max(n,i+1)});return n}
function reportBbq(){if(!FROM_OFFICE)return;let n=0;try{n=+localStorage.getItem('yakiniku_best_v1')||0}catch(e){}if(n>0)relayScore({game:'bbq',score:Math.round(n)})}
let playing='';
const KEEP_FRAME={zip:1,queens:1,sudoku:1,patches:1,bbq:1};
function dropFrame(k){if(KEEP_FRAME[k])return;const f=frames[k];if(!f)return;f.remove();delete frames[k]}
function route(){const k=location.hash.slice(1);const g=document.getElementById('game');
  if(playing==='bbq'&&k!=='bbq')reportBbq();
  if(playing&&playing!==k)dropFrame(playing);
  if(!GAMES[k]){playing='';g.classList.remove('show');document.getElementById('lobby').style.display='';document.title='小遊戲大廳';return}
  playing=k;document.getElementById('lobby').style.display='none';g.classList.add('show');document.getElementById('gname').textContent=NAMES[k];document.title=NAMES[k];
  for(const f of Object.values(frames))f.classList.remove('on');
  if(!frames[k]){const f=document.createElement('iframe');f.title=NAMES[k];f.id='f-'+k;f.className='on';f.srcdoc=GAMES[k];document.getElementById('frames').appendChild(f);frames[k]=f}
  else frames[k].classList.add('on')}
let nav=0;document.getElementById('back').onclick=()=>{if(nav>0){nav--;history.back()}else location.hash=''};
const SAVE_KEYS={cat2048:1};
addEventListener('message',e=>{
  if(e.origin!==location.origin)return;
  if(![...document.querySelectorAll('iframe')].some(f=>f.contentWindow===e.source))return;
  const d=e.data||{};
  try{
    if(d.lobbySave&&typeof d.lobbySave.key==='string'&&SAVE_KEYS[d.lobbySave.key]){localStorage.setItem('lobby_'+d.lobbySave.key,JSON.stringify(d.lobbySave.val));if(d.lobbySave.key==='cat2048'&&d.lobbySave.val)relayScore({game:'cat2048',score:Math.round(+d.lobbySave.val.best||0)})}
    if(typeof d.lobbyLoad==='string'&&SAVE_KEYS[d.lobbyLoad]){const v=JSON.parse(localStorage.getItem('lobby_'+d.lobbyLoad)||'null');if(v)e.source.postMessage({lobbyData:{key:d.lobbyLoad,val:v}},location.origin)}
    if(d.m3save){localStorage.setItem('lobby_m3',JSON.stringify(d.m3save));relayScore({game:'match3',score:matchCleared(d.m3save)})}
    if(d.m3load){const v=JSON.parse(localStorage.getItem('lobby_m3')||'null');if(v)e.source.postMessage({m3data:v},location.origin)}
    if(typeof d.officeSolve==='string'&&GAMES[d.officeSolve])relayScore({game:d.officeSolve,op:'solve'})
  }catch(_){}
});
addEventListener('storage',e=>{if(e.key==='yakiniku_best_v1')reportBbq()});
addEventListener('hashchange',()=>{if(GAMES[location.hash.slice(1)])nav++;else nav=0;route()});route();
</script></body></html>`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`wrote ${outFile} (${Buffer.byteLength(html)} bytes)`);

// Generated on every build (gitignored), so each deploy shows its own commit.
const versionFile = join(root, "public", "office", "version.txt");
const version = versionLabel(pkg.version);
writeFileSync(versionFile, version);
console.log(`wrote ${versionFile} (${version})`);

const tsc = join(root, "node_modules/typescript/bin/tsc");
if (!existsSync(tsc)) {
  console.log("typescript not installed; skip typecheck");
} else {
  const result = spawnSync(process.execPath, [tsc, "--noEmit"], { stdio: "inherit" });
  if (result.status) process.exit(result.status);
}
