/** Shared snack cabinet and vending machine stock for one office room. */

export const SNACK_FULL = 5;
export const SNACK_COOLDOWN_MS = 900;
export const SNACK_REACH = 108;
export const LALA_REACH = 120;
export const SNACK_META = "snack_stock";
export const HANDS_META = "snack_hands";

export const MACHINE_ID = {
  cabinet: "snack-cabinet",
  vendor: "snack-vendor",
} as const;

export type SnackMachine = keyof typeof MACHINE_ID;
export type SnackPose = "eat" | "drink";

export type SnackItem = {
  id: string;
  label: string;
  machine: SnackMachine;
  pose: SnackPose;
};

export const SNACK_ITEMS: readonly SnackItem[] = [
  { id: "cookie", label: "餅乾", machine: "cabinet", pose: "eat" },
  { id: "choco", label: "巧克力餅乾", machine: "cabinet", pose: "eat" },
  { id: "candy", label: "水果糖", machine: "cabinet", pose: "eat" },
  { id: "marsh", label: "棉花糖", machine: "cabinet", pose: "eat" },
  { id: "tea", label: "綠茶", machine: "vendor", pose: "drink" },
  { id: "soda", label: "汽水", machine: "vendor", pose: "drink" },
  { id: "juice", label: "果汁", machine: "vendor", pose: "drink" },
  { id: "latte", label: "咖啡牛奶", machine: "vendor", pose: "drink" },
];

export type Stock = Record<string, number>;
export type Anchor = { x: number; y: number };

const ITEM_BY_ID = new Map(SNACK_ITEMS.map((item) => [item.id, item]));

export function isFixedKind(kind: string): boolean {
  return kind === "snackcab" || kind === "vendor";
}

export function isFixedId(id: string): boolean {
  return id === MACHINE_ID.cabinet || id === MACHINE_ID.vendor;
}

export function fullStock(): Stock {
  const stock: Stock = {};
  for (const item of SNACK_ITEMS) stock[item.id] = SNACK_FULL;
  return stock;
}

export function parseStock(raw: string | null | undefined): Stock {
  const stock = fullStock();
  if (!raw) return stock;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return stock;
  }
  if (!parsed || typeof parsed !== "object") return stock;
  const src = parsed as Record<string, unknown>;
  for (const item of SNACK_ITEMS) {
    const value = src[item.id];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= SNACK_FULL) {
      stock[item.id] = value;
    }
  }
  return stock;
}

export function parseHands(raw: string | null | undefined): Map<string, string> {
  const hands = new Map<string, string>();
  if (!raw) return hands;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return hands;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return hands;
  for (const [id, itemId] of Object.entries(parsed as Record<string, unknown>)) {
    if (id && typeof itemId === "string" && ITEM_BY_ID.has(itemId)) hands.set(id, itemId);
  }
  return hands;
}

export type TakeFail = "unknown" | "empty" | "far" | "cool";

export type TakeResult =
  | { ok: true; itemId: string; pose: SnackPose; replaced: boolean; stock: Stock }
  | { ok: false; reason: TakeFail };

export type UseResult =
  | { ok: true; itemId: string; pose: SnackPose; stock: Stock }
  | { ok: false; reason: "empty" };

export type RestockResult =
  | { ok: false; reason: "far" }
  | { ok: true; line: string; changed: boolean; stock: Stock };

export class SnackRoom {
  private stock: Stock;
  private readonly last = new Map<string, number>();
  private hands = new Map<string, string>();

  constructor(raw?: string | null, handsRaw?: string | null) {
    this.stock = parseStock(raw);
    this.hands = parseHands(handsRaw);
  }

  load(raw: string | null | undefined, handsRaw?: string | null) {
    this.stock = parseStock(raw);
    this.hands = parseHands(handsRaw);
    this.last.clear();
  }

  view(): Stock {
    return { ...this.stock };
  }

  hand(playerId: string): string {
    return this.hands.get(playerId) || "";
  }

  handsView(only?: (id: string) => boolean): Array<{ id: string; item: string; pose: SnackPose }> {
    const list: Array<{ id: string; item: string; pose: SnackPose }> = [];
    for (const [id, itemId] of this.hands) {
      if (only && !only(id)) continue;
      const item = ITEM_BY_ID.get(itemId);
      if (!item) continue;
      list.push({ id, item: item.id, pose: item.pose });
    }
    return list;
  }

  /** Returns true when the player was holding something. */
  release(playerId: string): boolean {
    return this.hands.delete(playerId);
  }

  save(): string {
    return JSON.stringify(this.stock);
  }

  saveHands(): string {
    return JSON.stringify(Object.fromEntries(this.hands));
  }

  take(
    playerId: string,
    itemId: unknown,
    x: number,
    y: number,
    anchorFor: (machine: SnackMachine) => Anchor | null,
    now: number,
  ): TakeResult {
    if (typeof itemId !== "string") return { ok: false, reason: "unknown" };
    const item = ITEM_BY_ID.get(itemId);
    if (!item) return { ok: false, reason: "unknown" };
    const prev = this.last.get(playerId);
    if (prev != null && now - prev < SNACK_COOLDOWN_MS) return { ok: false, reason: "cool" };
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: "far" };
    const anchor = anchorFor(item.machine);
    if (!anchor || Math.hypot(x - anchor.x, y - anchor.y) > SNACK_REACH) return { ok: false, reason: "far" };
    if ((this.stock[item.id] || 0) <= 0) return { ok: false, reason: "empty" };
    const replaced = this.hands.has(playerId);
    this.stock[item.id] -= 1;
    this.hands.set(playerId, item.id);
    this.last.set(playerId, now);
    return { ok: true, itemId: item.id, pose: item.pose, replaced, stock: this.view() };
  }

  use(playerId: string): UseResult {
    const itemId = this.hands.get(playerId);
    const item = itemId ? ITEM_BY_ID.get(itemId) : undefined;
    if (!item) return { ok: false, reason: "empty" };
    this.hands.delete(playerId);
    return { ok: true, itemId: item.id, pose: item.pose, stock: this.view() };
  }

  restock(x: number, y: number, lala: Anchor): RestockResult {
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x - lala.x, y - lala.y) > LALA_REACH) {
      return { ok: false, reason: "far" };
    }
    let changed = false;
    for (const item of SNACK_ITEMS) {
      if ((this.stock[item.id] || 0) <= 0) {
        this.stock[item.id] = SNACK_FULL;
        changed = true;
      }
    }
    return {
      ok: true,
      changed,
      stock: this.view(),
      line: changed ? "好的，馬上幫你補上！" : "零食和飲料都還有喔。",
    };
  }
}
