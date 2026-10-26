// Gate forms, device pairing, clock out, and the first boot.
import { attachLoginOptions } from "./login-options.js";
import { closeSheets, paintCam } from "./game.js";
import { api, applySession, connect, setConn, showGate } from "./net.js";
import { $, DEVICE, SESSION, state } from "./office-state.js";

// Set by wireLogin(); net.js repaints it when the profile changes.
export let loginOptions = null;

// Set once the visitor submits the password, so a slow boot reply cannot reset the gate.
let loginStarted = false;

let parkTimer = 0;

export function stopParkWatch() {
  window.clearInterval(parkTimer);
  parkTimer = 0;
}

function deviceKey() {
  let key = localStorage.getItem(DEVICE);
  if (!/^[a-f0-9]{32,128}$/i.test(key || "")) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    key = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(DEVICE, key);
  }
  return key.toLowerCase();
}

function checkId(raw) {
  const id = String(raw || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,15}$/.test(id)) {
    return { ok: false, error: "ID 需為 2 到 16 個字，以英數開頭，只能使用英數、底線或減號" };
  }
  if (["lala", "admin", "system", "npc", "office"].includes(id)) return { ok: false, error: "這個 ID 不能使用" };
  return { ok: true, id };
}

function showRegister() {
  $("form-password").hidden = true;
  $("form-register").hidden = false;
  $("form-pair").hidden = true;
  $("gate-msg").textContent = "密碼正確。幫自己取一個還沒人用的 ID，再寫顯示名稱。";
  $("gate-error").textContent = "";
  $("office-id").focus();
}

function showPairForm() {
  $("form-password").hidden = true;
  $("form-register").hidden = true;
  $("form-pair").hidden = false;
  $("gate-msg").textContent = "輸入你的 ID，以及另一台裝置上的代碼。";
  $("gate-error").textContent = "";
  $("pair-id").focus();
}

export function showElsewhere() {
  closeSheets();
  state.parked = true;
  state.connected = false;
  $("pair-dialog").hidden = true;
  $("elsewhere").hidden = false;
  setConn("已在其他裝置上線", true);
  if (parkTimer) return;
  parkTimer = window.setInterval(async () => {
    if (!state.parked) {
      stopParkWatch();
      return;
    }
    const me = await api("/api/office/me");
    if (!state.parked) return;
    if (!me.ok) showGate("已在其他裝置下班。下次輸入辦公室密碼就能回來。");
  }, 1000);
}

export function wireLogin() {
  $("form-password").addEventListener("submit", async (event) => {
    event.preventDefault();
    loginStarted = true;
    const password = $("office-password").value.trim();
    const button = event.submitter;
    if (button) button.disabled = true;
    const result = await api("/api/office/login", {
      method: "POST",
      token: "",
      body: { password, deviceKey: deviceKey() },
    });
    if (button) button.disabled = false;
    if (!result.ok && !result.needsRegistration) {
      $("gate-error").textContent = result.error || "密碼不正確";
      return;
    }
    state.password = password;
    if (result.profile) {
      state.password = "";
      applySession(result);
      return;
    }
    showRegister();
  });

  $("form-register").addEventListener("submit", async (event) => {
    event.preventDefault();
    const idCheck = checkId($("office-id").value);
    const displayName = $("office-name").value.trim();
    if (!idCheck.ok) { $("gate-error").textContent = idCheck.error; return; }
    if (!displayName) { $("gate-error").textContent = "請輸入顯示名稱"; return; }
    const button = event.submitter;
    if (button) button.disabled = true;
    const result = await api("/api/office/register", {
      method: "POST",
      token: "",
      body: { password: state.password, deviceKey: deviceKey(), id: idCheck.id, displayName },
    });
    if (button) button.disabled = false;
    if (!result.ok) { $("gate-error").textContent = result.error || "沒有登記成功"; return; }
    state.password = "";
    applySession(result);
  });

  $("back-password").addEventListener("click", () => showGate("再輸入一次辦公室密碼。"));
  $("have-id").addEventListener("click", () => showPairForm());
  $("pair-back").addEventListener("click", () => showRegister());
  $("form-pair").addEventListener("submit", async (event) => {
    event.preventDefault();
    const idCheck = checkId($("pair-id").value);
    if (!idCheck.ok) { $("gate-error").textContent = idCheck.error; return; }
    const button = event.submitter;
    if (button) button.disabled = true;
    const result = await api("/api/office/pair", {
      method: "POST",
      body: { password: state.password, deviceKey: deviceKey(), id: idCheck.id, code: $("pair-code-input").value },
    });
    if (button) button.disabled = false;
    if (!result.ok) { $("gate-error").textContent = result.error || "沒有加入"; return; }
    state.password = "";
    applySession(result);
  });
  loginOptions = attachLoginOptions({
    api,
    deviceKey,
    start: () => { loginStarted = true; $("gate-error").textContent = ""; },
    fail: (text) => { $("gate-error").textContent = text; },
    done: (result) => { state.password = ""; applySession(result); },
    isGuest: () => Boolean(state.profile?.id?.startsWith("guest-")),
    // The guest socket is closed by the office; reconnect as the member.
    upgraded: (result) => {
      state.profile = result.profile;
      state.catalog = result.catalog;
      connect();
    },
  });
}

export async function clockOut() {
  state.clocked = true;
  $("clockout").hidden = true;
  const result = await api("/api/office/logout", { method: "POST", body: {} });
  try { state.socket?.close(); } catch { /* already closing */ }
  showGate(result.ok ? "辛苦了，明天見！" : "下班沒有完成，請再試一次。");
  state.clocked = false;
}

export function openClockout() {
  if (state.gate || $("avatar").hidden === false && state.avatarMode === "first") return;
  $("clockout").hidden = false;
}

export async function boot() {
  paintCam();
  const legacy = localStorage.getItem(SESSION);
  if (legacy) {
    await api("/api/office/session", { method: "POST", token: legacy, body: {} });
    localStorage.removeItem(SESSION);
  }
  const me = await api("/api/office/me");
  if (loginStarted) return;
  if (me.ok) { applySession(me); return; }
  const status = await api("/api/office/status", { token: "" });
  if (loginStarted) return;
  if (status.ok && status.hasPassword === false) {
    showGate("管理員還沒設定辦公室密碼。請先到管理頁設定。", { keepPassword: true });
    $("form-password").hidden = true;
    return;
  }
  showGate("輸入管理員給大家的辦公室密碼。這台裝置會記住你。", { keepPassword: true });
}

export async function openPair() {
  closeSheets();
  $("pair-dialog").hidden = false;
  $("pair-error").textContent = "";
  $("pair-code").textContent = "……";
  const result = await api("/api/office/pair/code", { method: "POST", body: {} });
  if (!result.ok) {
    $("pair-error").textContent = result.error || "沒有產生代碼";
    $("pair-code").textContent = "------";
    return;
  }
  const code = String(result.code || "");
  $("pair-code").textContent = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
