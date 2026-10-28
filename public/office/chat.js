// The chat bar.
import { send } from "./net.js";
import { $, phoneQuery, state } from "./office-state.js";

export let composing = false;
export let justEnded = false;
const chat = $("chat-input");

export function wireChat() {
  chat.addEventListener("compositionstart", () => {
    composing = true;
    justEnded = false;
  });
  chat.addEventListener("compositionend", () => {
    composing = false;
    justEnded = true;
    setTimeout(() => { justEnded = false; }, 0);
  });
  chat.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    const keyCode = event.keyCode || event.which || 0;
    if (composing || event.isComposing || keyCode === 229 || justEnded) {
      if (event.key === "Enter") event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape" || !chat.value.trim()) {
      event.preventDefault();
      chat.blur();
    }
  });

  chat.addEventListener("focus", () => {
    state.keys.clear();
    paintChatTip();
  });
  chat.addEventListener("blur", paintChatTip);
  paintChatTip();
  $("chatbar").addEventListener("submit", (event) => {
    event.preventDefault();
    if (composing || justEnded) return;
    const text = chat.value.trim();
    if (!text) return;
    send({ t: "chat", text, whisper: Boolean(state.whisper) });
    chat.value = "";
  });
}

export function paintChatTip() {
  const input = $("chat-input");
  if (!input) return;
  const hush = Boolean(state.whisper);
  const room = !hush && Boolean(state.inMeeting);
  if (phoneQuery.matches) input.placeholder = hush ? "這句只有這一圈人看得到" : room ? "只有會議室裡的人看得到" : "說點什麼…（Enter 送出）";
  else if (document.activeElement === input) input.placeholder = hush ? "悄悄話：Enter 送出，Esc 回到行走" : room ? "會議室：只有室內的人看得到，Enter 送出" : "Enter 送出，Esc 回到行走";
  else input.placeholder = hush ? "按 T 說悄悄話，Esc 回到行走" : room ? "按 T 在會議室說話，只有室內的人看得到" : "按 T 開始輸入，Esc 回到行走";
}

export function openChat() {
  if ($("chatbar").hidden || !chat.getClientRects().length) return false;
  chat.focus();
  return document.activeElement === chat;
}
