// The arcade frame and the score board.
import { snacks, toys } from "./game.js";
import { requests } from "./net.js";
import { $, state } from "./office-state.js";

export function openArcade() {
  snacks.close();
  toys.close();
  state.arcade = true;
  state.path = [];
  $("dialogue").hidden = true;
  $("arcade").hidden = false;
  $("arcade-frame").src = "/games/?from=office";
}

export function closeArcade() {
  state.arcade = false;
  const frame = $("arcade-frame");
  if (frame) {
    frame.src = "about:blank";
    $("arcade").hidden = true;
  }
}

export function openBoard() {
  snacks.close();
  toys.close();
  state.boardOpen = true;
  state.path = [];
  $("dialogue").hidden = true;
  $("board").hidden = false;
  void refreshBoard();
}

export function closeBoard() {
  state.boardOpen = false;
  const node = $("board");
  if (node) node.hidden = true;
}

export async function refreshBoard() {
  const data = await requests.ask("leaderboard");
  if (!data.ok || !state.boardOpen) return;
  state.leaderboard = data.games || [];
  renderBoard();
}

function renderBoard() {
  const games = state.leaderboard || [];
  const tabs = $("board-tabs");
  tabs.replaceChildren();
  if (!games.some((game) => game.id === state.boardGame) && games[0]) state.boardGame = games[0].id;
  for (const game of games) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost";
    button.textContent = game.title;
    button.setAttribute("aria-pressed", game.id === state.boardGame ? "true" : "false");
    button.addEventListener("click", () => {
      state.boardGame = game.id;
      renderBoard();
    });
    tabs.appendChild(button);
  }
  const current = games.find((game) => game.id === state.boardGame);
  const list = $("board-list");
  list.replaceChildren();
  const me = $("board-me");
  if (!current) {
    me.textContent = "";
    return;
  }
  if (!current.top.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "還沒有紀錄";
    list.appendChild(empty);
  }
  for (const row of current.top) {
    const item = document.createElement("li");
    if (row.id === state.me?.id) item.className = "me";
    const name = document.createElement("span");
    name.textContent = `${row.rank}. ${row.displayName}`;
    const id = document.createElement("small");
    id.textContent = `@${row.id}`;
    const score = document.createElement("b");
    score.textContent = `${row.score} ${current.unit}`;
    item.append(name, id, score);
    list.appendChild(item);
  }
  if (current.me) me.textContent = `你是第 ${current.me.rank} 名，${current.me.score} ${current.unit}`;
  else me.textContent = "你還沒有紀錄";
}

export async function submitScore(payload) {
  if (!payload || state.gate) return;
  const data = await requests.ask("score", payload);
  if (data.ok && state.boardOpen) void refreshBoard();
}
