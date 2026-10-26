// Shared office client state: constants, the 3D world, and the live state object.
import { createWorld } from "./world3d.js";

export const SESSION = "office_session";
export const DEVICE = "office_device";
export const TILE = 32;
export const SPEED = 170;
// Shift on a keyboard, or the stick pushed to its rim, runs.
export const RUN_SPEED = 280;
export const WHISPER_NEAR = 112;
export const WHISPER_FAR = 176;

export const $ = (id) => document.getElementById(id);
// version.txt is written by `npm run build`; without it the label reads "dev".
fetch("/office/version.txt", { cache: "no-cache" })
  .then((response) => (response.ok ? response.text() : "dev"), () => "dev")
  .then((text) => document.querySelectorAll(".version").forEach((el) => { el.textContent = text.trim().slice(0, 40) || "dev"; }));
export const canvas = $("view");
export const world = createWorld({
  view: canvas,
  preview: $("preview"),
  labels: $("labels"),
  fallback: $("webgl-fallback"),
});

export const state = {
  map: null,
  me: null,
  profile: null,
  catalog: null,
  others: new Map(),
  furniture: [],
  specs: new Map(),
  bubbles: new Map(),
  connected: false,
  editing: false,
  armed: null,
  selected: null,
  focus: null,
  keys: new Set(),
  path: [],
  socket: null,
  zoneName: "",
  gate: true,
  password: "",
  avatarMode: "first",
  avatarAnimal: "cat",
  look: null,
  lookTab: "preset",
  colorKey: "body",
  seat: null,
  rising: false,
  whisper: null,
  groups: new Map(),
  memberGroup: new Map(),
  asks: [],
  whisperArm: false,
  whisperNote: "",
  whisperNoteUntil: 0,
  tape: [],
  ride: { vx: 0, vy: 0 },
  rideWish: null,
  bumpAt: new Map(),
  backoff: 700,
  sentX: 0,
  sentY: 0,
  sentAt: 0,
  dirty: false,
  drag: null,
  pan: null,
  hint: "",
  help: false,
  arcade: false,
  boardOpen: false,
  boardGame: "cat2048",
  leaderboard: null,
  cam: { x: 0, y: 0 },
  anim: 0,
  loop: false,
  parked: false,
  orbit: null,
  stickX: 0,
  stickY: 0,
  clocked: false,
  sentFace: null,
  sentFaceAt: 0,
  faceFlush: false,
};

export const phoneQuery = window.matchMedia("(max-width: 980px)");

export function setHint(text) {
  state.hint = text || "";
  $("hint").textContent = state.hint;
  $("hint").hidden = !state.hint;
}
