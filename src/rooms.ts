import type { Prop } from "./content";
import { STALL_INNER, STALL_X } from "./stalls";

// Fixed room dressing for the restrooms, the gym and the pantry. Each entry is
// one GLB from public/office/assets/kenney fitted into its box (1 unit = 1 px).
// `tall` caps the model height, `lift` raises it onto a counter or shelf, and
// `rot` turns it the same way furniture turns (0 faces south).

function piece(
  model: string,
  x: number,
  y: number,
  w: number,
  h: number,
  tall: number,
  opts: { solid?: boolean; rot?: number; lift?: number } = {},
): Prop {
  return { kind: "decor", model, x, y, w, h, tall, solid: opts.solid ?? true, rot: opts.rot ?? 0, lift: opts.lift };
}

// Restroom: x 32–384, y 800–1056, door at x 192–256, stalls x 32–288 along the south
// wall, sinks in the north-east corner. Toilet roll holders sit on each stall's east
// partition, beside the toilet.
function restroomDecor(): Prop[] {
  const step = 8 + STALL_INNER;
  const rolls = [1, 2].map((n) => piece("bath-roll", STALL_X + n * step - 12, 1016, 12, 8, 7, { solid: false, lift: 16, rot: 270 }));
  return [
    ...rolls,
    piece("bath-mat", 306, 834, 36, 24, 2, { solid: false }),
    piece("bath-mat", 346, 834, 36, 24, 2, { solid: false }),
    piece("bath-plant", 38, 806, 20, 20, 22),
    piece("bath-plant", 358, 1030, 20, 20, 22),
  ];
}

// Gym: x 416–640, y 800–1056, door at x 480–544. The column below the door
// and the row along the north wall stay clear as the walkway.
function gymDecor(): Prop[] {
  return [
    piece("gym-treadmill", 418, 808, 30, 64, 46, { rot: 90 }),
    piece("gym-treadmill", 450, 808, 30, 64, 46, { rot: 90 }),
    piece("gym-bike", 424, 900, 24, 42, 40, { rot: 90 }),
    piece("gym-kettlebells", 422, 970, 20, 40, 14, { rot: 90 }),
    piece("gym-bench", 548, 884, 14, 44, 16, { rot: 90 }),
    piece("gym-dumbbells", 610, 866, 24, 40, 32, { rot: 270 }),
    piece("gym-cooler", 614, 808, 18, 18, 40),
    piece("gym-mats", 488, 996, 64, 50, 6, { solid: false }),
    piece("gym-ball", 568, 1016, 22, 22, 22),
  ];
}

// Pantry: x 672–928, y 800–1056, door at x 736–800. An L-shaped counter runs
// along the north and east walls; a bar table with stools sits in the middle.
function pantryDecor(): Prop[] {
  const top = 32;
  return [
    piece("kitchenCabinet", 800, 800, 32, 30, top),
    piece("kitchenSink", 832, 800, 32, 30, top + 2),
    piece("kitchenCabinet", 864, 800, 32, 30, top),
    piece("kitchenCabinet", 896, 800, 32, 30, top),
    piece("kitchenCabinet", 898, 832, 30, 32, top, { rot: 270 }),
    piece("kitchenCabinet", 898, 864, 30, 32, top, { rot: 270 }),
    piece("kitchenFridge", 898, 896, 30, 32, 54, { rot: 270 }),
    ...[800, 864, 896].map((x) => piece("kitchenCabinetUpper", x, 800, 32, 10, 15, { solid: false, lift: 42 })),
    piece("kitchen-toaster", 806, 806, 18, 14, 10, { solid: false, lift: top }),
    piece("kitchen-dishrack", 868, 804, 22, 20, 16, { solid: false, lift: top }),
    piece("kitchen-kettle", 900, 806, 14, 12, 12, { solid: false, lift: top }),
    piece("kitchen-mug", 918, 814, 8, 8, 6, { solid: false, lift: top }),
    piece("kitchenMicrowave", 902, 836, 24, 20, 16, { solid: false, lift: top, rot: 270 }),
    piece("plantSmall1", 906, 870, 14, 14, 18, { solid: false, lift: top }),
    piece("rugRectangle", 740, 884, 116, 116, 2, { solid: false }),
    piece("tableRound", 776, 920, 44, 44, 30),
    piece("stoolBar", 790, 894, 16, 16, 22),
    piece("stoolBar", 750, 934, 16, 16, 22),
    piece("stoolBar", 830, 934, 16, 16, 22),
    piece("stoolBar", 790, 974, 16, 16, 22),
    piece("kitchen-mug", 790, 936, 8, 8, 6, { solid: false, lift: 30 }),
    piece("bookcaseOpenLow", 676, 872, 24, 64, 30, { rot: 90 }),
    piece("chocolate", 680, 878, 14, 10, 3, { solid: false, lift: 30, rot: 90 }),
    piece("soda-can", 682, 896, 8, 8, 10, { solid: false, lift: 30 }),
    piece("cookie", 680, 912, 12, 12, 4, { solid: false, lift: 30 }),
    piece("donut", 680, 922, 12, 12, 5, { solid: false, lift: 30 }),
    piece("trashcan", 710, 806, 16, 16, 20),
    piece("pottedPlant", 678, 1024, 24, 26, 48),
  ];
}

export function roomDecor(): Prop[] {
  return [...restroomDecor(), ...gymDecor(), ...pantryDecor()];
}
