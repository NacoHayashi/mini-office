// The avatar look editor and its preview.
import { ensureLoop, snacks, toys } from "./game.js";
import { connect, requests, send, sendMove, socketLive, startGame } from "./net.js";
import { $, state, world } from "./office-state.js";

function profileNow() {
  return state.me || state.profile;
}

const LOOK_TABS = [
  ["preset", "預設"],
  ["body", "體型"],
  ["ears", "耳朵"],
  ["tail", "尾巴"],
  ["colors", "顏色"],
  ["face", "臉"],
  ["gear", "配件"],
];

export function cloneLook(look) {
  if (!look || typeof look !== "object") return null;
  return { ...look, v: 2, colors: { ...(look.colors || {}) } };
}

export function presetOf(id) {
  return (state.catalog?.animals || []).find((item) => item.id === id) || null;
}

export function showAvatar(mode) {
  snacks.close();
  toys.close();
  state.avatarMode = mode;
  state.gate = mode === "first";
  const profile = profileNow();
  state.avatarAnimal = profile?.animal || state.catalog?.animals?.[0]?.id || "cat";
  state.look = cloneLook(profile?.look) || cloneLook(presetOf(state.avatarAnimal)?.look) || cloneLook(presetOf("cat")?.look);
  state.lookTab = "preset";
  $("avatar-name").value = profile?.displayName || "";
  $("avatar-title").textContent = mode === "mirror" ? "廁所鏡子" : "打造你的造型";
  $("avatar-note").textContent = mode === "mirror"
    ? "只有在男廁或女廁可以調整造型。名稱也可以一起改。"
    : `大家會看到這個造型。名稱下面會標 @${profile?.id || "id"}。`;
  $("avatar-save").textContent = mode === "mirror" ? "換上這個造型" : "進入辦公室";
  $("avatar-cancel").hidden = mode !== "mirror";
  $("avatar-error").textContent = "";
  $("gate").hidden = true;
  $("avatar").hidden = false;
  buildLookEditor();
  world.resize();
  paintPreview();
  ensureLoop();
}

function buildLookEditor() {
  const tabs = $("look-tabs");
  const panel = $("look-panel");
  tabs.replaceChildren();
  panel.replaceChildren();
  for (const [id, label] of LOOK_TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(state.lookTab === id));
    button.addEventListener("click", () => {
      state.lookTab = id;
      buildLookEditor();
    });
    tabs.appendChild(button);
  }
  const catalog = state.catalog || { animals: [], parts: {}, colors: [], swatches: [] };
  if (state.lookTab === "preset") {
    const note = document.createElement("p");
    note.className = "slot-label";
    note.textContent = "點一個預設會填好全身，之後每個部位都能再改。";
    panel.appendChild(note);
    const row = document.createElement("div");
    row.className = "choice-grid";
    for (const animal of catalog.animals || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = animal.label;
      button.setAttribute("aria-pressed", String(state.avatarAnimal === animal.id));
      button.addEventListener("click", () => {
        state.avatarAnimal = animal.id;
        state.look = cloneLook(animal.look) || state.look;
        buildLookEditor();
        paintPreview();
      });
      row.appendChild(button);
    }
    panel.appendChild(row);
    return;
  }
  if (state.lookTab === "colors") {
    buildColorPanel(panel, catalog);
    return;
  }
  if (state.lookTab === "face") {
    addChoiceGroup(panel, "眼睛", "eyes", catalog.parts?.eyes || []);
    addChoiceGroup(panel, "嘴巴", "mouth", catalog.parts?.mouth || []);
    addChoiceGroup(panel, "腮紅", "blush", catalog.parts?.blush || []);
    addChoiceGroup(panel, "標記", "marking", catalog.parts?.marking || []);
    return;
  }
  if (state.lookTab === "gear") {
    addChoiceGroup(panel, "頭上", "head", catalog.parts?.head || []);
    addAccessorySwatches(panel, catalog, "head", "頭上顏色");
    addChoiceGroup(panel, "臉上", "face", catalog.parts?.face || []);
    addChoiceGroup(panel, "頸部", "neck", catalog.parts?.neck || []);
    addAccessorySwatches(panel, catalog, "neck", "頸部顏色");
    addChoiceGroup(panel, "手上", "held", catalog.parts?.held || []);
    addAccessorySwatches(panel, catalog, "held", "手上顏色");
    return;
  }
  const titles = { body: "體型", ears: "耳朵", tail: "尾巴" };
  addChoiceGroup(panel, titles[state.lookTab] || state.lookTab, state.lookTab, catalog.parts?.[state.lookTab] || []);
}

function addChoiceGroup(panel, label, key, options) {
  const title = document.createElement("p");
  title.className = "slot-label";
  title.textContent = label;
  panel.appendChild(title);
  const row = document.createElement("div");
  row.className = "choice-grid";
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.setAttribute("aria-pressed", String(state.look?.[key] === option.id));
    button.addEventListener("click", () => {
      state.look = { ...state.look, [key]: option.id };
      state.avatarAnimal = "custom";
      buildLookEditor();
      paintPreview();
    });
    row.appendChild(button);
  }
  panel.appendChild(row);
}

function addAccessorySwatches(panel, catalog, slot, label) {
  if (!state.look?.[slot] || state.look[slot] === "none") return;
  const title = document.createElement("p");
  title.className = "slot-label";
  title.textContent = label;
  panel.appendChild(title);
  const swatches = document.createElement("div");
  swatches.className = "swatches accessory-swatches";
  const options = catalog.accessorySwatches?.length ? catalog.accessorySwatches : ["#f3eee3"];
  const colors = state.look?.colors || {};
  const current = String(colors[slot] || colors.accessory || "#f3eee3").toLowerCase();
  for (const swatch of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.style.background = swatch;
    button.setAttribute("aria-label", `${label} ${swatch}`);
    button.setAttribute("aria-pressed", String(current === String(swatch).toLowerCase()));
    button.addEventListener("click", () => {
      state.look = { ...state.look, colors: { ...(state.look?.colors || {}), [slot]: swatch } };
      state.avatarAnimal = "custom";
      buildLookEditor();
      paintPreview();
    });
    swatches.appendChild(button);
  }
  panel.appendChild(swatches);
}

function buildColorPanel(panel, catalog) {
  // The belly patch is no longer drawn, so its color is not offered.
  const keys = (catalog.colors || []).filter((item) => item.id !== "belly");
  if (!keys.some((item) => item.id === state.colorKey)) state.colorKey = keys[0]?.id || "body";
  const chips = document.createElement("div");
  chips.className = "color-keys";
  for (const item of keys) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.setAttribute("aria-pressed", String(state.colorKey === item.id));
    button.addEventListener("click", () => {
      state.colorKey = item.id;
      buildLookEditor();
    });
    chips.appendChild(button);
  }
  panel.appendChild(chips);
  const item = keys.find((entry) => entry.id === state.colorKey);
  if (!item) return;
  const block = document.createElement("div");
  block.className = "color-row";
  const swatches = document.createElement("div");
  swatches.className = "swatches";
  const current = String(state.look?.colors?.[item.id] || "").toLowerCase();
  for (const swatch of catalog.swatches || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.style.background = swatch;
    button.setAttribute("aria-label", `${item.label} ${swatch}`);
    button.setAttribute("aria-pressed", String(current === swatch.toLowerCase()));
    button.addEventListener("click", () => {
      state.look = { ...state.look, colors: { ...state.look.colors, [item.id]: swatch } };
      state.avatarAnimal = "custom";
      buildLookEditor();
      paintPreview();
    });
    swatches.appendChild(button);
  }
  const input = document.createElement("input");
  input.type = "color";
  input.value = /^#[0-9a-f]{6}$/.test(current) ? current : "#f06292";
  input.setAttribute("aria-label", `${item.label}自訂`);
  input.addEventListener("input", () => {
    state.look = { ...state.look, colors: { ...state.look.colors, [item.id]: input.value.toLowerCase() } };
    state.avatarAnimal = "custom";
    paintPreview();
  });
  swatches.appendChild(input);
  block.appendChild(swatches);
  panel.appendChild(block);
}

function randomLook() {
  const catalog = state.catalog;
  if (!catalog?.parts || !state.look) return;
  const pick = (list) => list[Math.floor(Math.random() * list.length)]?.id;
  const swatches = catalog.swatches || [];
  const color = () => swatches[Math.floor(Math.random() * swatches.length)] || "#f06292";
  const colors = {};
  for (const item of catalog.colors || []) colors[item.id] = color();
  const accessorySwatches = catalog.accessorySwatches?.length ? catalog.accessorySwatches : ["#f3eee3"];
  for (const slot of ["accessory", "head", "neck", "held"]) {
    colors[slot] = accessorySwatches[Math.floor(Math.random() * accessorySwatches.length)];
  }
  state.look = {
    v: 2,
    body: pick(catalog.parts.body),
    ears: pick(catalog.parts.ears),
    tail: pick(catalog.parts.tail),
    belly: false,
    eyes: pick(catalog.parts.eyes),
    mouth: pick(catalog.parts.mouth),
    blush: pick(catalog.parts.blush),
    marking: pick(catalog.parts.marking),
    head: pick(catalog.parts.head),
    face: pick(catalog.parts.face),
    neck: pick(catalog.parts.neck),
    held: pick(catalog.parts.held),
    colors,
  };
  state.avatarAnimal = "custom";
  buildLookEditor();
  paintPreview();
}

export function paintPreview() {
  world.preview(state.look, performance.now() / 1000);
}

export function wireLook() {
  $("avatar-cancel").addEventListener("click", () => { $("avatar").hidden = true; });
  $("avatar-random").addEventListener("click", () => randomLook());
  $("avatar-save").addEventListener("click", async () => {
    const displayName = $("avatar-name").value.trim() || profileNow()?.displayName;
    const body = { displayName, animal: state.avatarAnimal, look: state.look };
    if (!displayName) { $("avatar-error").textContent = "請輸入顯示名稱"; return; }
    if (state.avatarMode === "first") {
      if (!socketLive()) connect();
      const result = await requests.ask("setup", body);
      if (!result.ok) { $("avatar-error").textContent = result.error || "沒有儲存"; return; }
      state.profile = result.profile;
      $("avatar").hidden = true;
      startGame();
      return;
    }
    sendMove(true);
    send({ t: "profile", ...body });
  });
}
