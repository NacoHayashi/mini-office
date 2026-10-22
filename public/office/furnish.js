import * as THREE from "./vendor/three.module.js";
import { GLTFLoader } from "./vendor/gltf.js";
import { addOutline, edgeColor, stepGradient } from "./toon.js";

// Tiny Treats (Bubbly Bathroom, Charming Kitchen) and One More Rep share one
// small recolored atlas per pack, so they load like the textured Kenney kits.
const TINY_TREATS = ["bath-toilet", "bath-sink", "bath-mirror", "bath-mat", "bath-roll", "bath-plant", "kitchen-kettle", "kitchen-mug", "kitchen-dishrack", "kitchen-toaster"];
const ONE_MORE_REP = ["gym-treadmill", "gym-bike", "gym-dumbbells", "gym-kettlebells", "gym-bench", "gym-mats", "gym-ball", "gym-cooler"];

const FILES = [
  "desk",
  "chairDesk",
  "chairRounded",
  "loungeSofa",
  "table",
  "tableCoffee",
  "bookcaseOpen",
  "books",
  "pottedPlant",
  "plantSmall1",
  "lampSquareFloor",
  "televisionModern",
  "cabinetTelevision",
  "rugRounded",
  "kitchenCabinet",
  "kitchenCoffeeMachine",
  "kitchenSink",
  "kitchenCabinetUpper",
  "kitchenFridge",
  "kitchenMicrowave",
  "tableRound",
  "stoolBar",
  "rugRectangle",
  "trashcan",
  "speaker",
  "computerScreen",
  "computerKeyboard",
  "computerMouse",
  "laptop",
  "pillow",
  "doorway",
  "wall",
  "vending-machine",
  "plate",
  "cookie",
  "cupcake",
  "cup-tea",
  "donut",
  "bookcaseOpenLow",
  "bear",
  "tool-hammer",
  "ball-red",
  "vehicle-racer",
  "chocolate",
  "soda-can",
  ...TINY_TREATS,
  ...ONE_MORE_REP,
];

const PALETTE = {
  wood: { color: 0xf2d0a4, roughness: 0.94, metalness: 0 },
  woodDark: { color: 0xd8b48c, roughness: 0.92, metalness: 0 },
  carpet: { color: 0xfff6ea, roughness: 0.96, metalness: 0 },
  carpetWhite: { color: 0xfffaf4, roughness: 0.96, metalness: 0 },
  carpetDarker: { color: 0xf3c3d4, roughness: 0.96, metalness: 0 },
  carpetBlue: { color: 0xd9c8f5, roughness: 0.96, metalness: 0 },
  metal: { color: 0xe7ded4, roughness: 0.58, metalness: 0.06 },
  metalLight: { color: 0xfff8f2, roughness: 0.5, metalness: 0.05 },
  metalMedium: { color: 0xb7b0c2, roughness: 0.52, metalness: 0.08 },
  metalDark: { color: 0x3a3446, roughness: 0.42, metalness: 0.12 },
  fur: { color: 0xe9bf94, roughness: 0.96, metalness: 0 },
  plant: { color: 0x7dca78, roughness: 0.88, metalness: 0 },
  lamp: { color: 0xfff1c4, roughness: 0.62, metalness: 0, emissive: 0xffe29a, emissiveIntensity: 0.55 },
  glass: { color: 0xd7f4ff, roughness: 0.12, metalness: 0.02, transparent: true, opacity: 0.45 },
  _defaultMat: { color: 0xfff6ea, roughness: 0.92, metalness: 0 },
};

// Only the big pieces get an edge line. Small desk clutter stays plain so a
// busy office does not double its draw calls on phones.
const OUTLINED = new Set(["desk", "loungeSofa", "bookcaseOpen", "bookcaseOpenLow", "kitchenCabinet", "kitchenSink", "kitchenFridge", "table", "cabinetTelevision", "bath-toilet", "bath-sink", "gym-treadmill", "doorway", "wall"]);
// Mini Arcade, Food Kit, Survival Kit, Minigolf Kit, Toy Car Kit and the itch.io packs ship a colormap instead of Furniture Kit material names.
const TEXTURED = new Set(["vending-machine", "plate", "cookie", "cupcake", "cup-tea", "donut", "tool-hammer", "ball-red", "vehicle-racer", "chocolate", "soda-can", ...TINY_TREATS, ...ONE_MORE_REP]);
const ramp = stepGradient([178, 224, 255]);

function recolor(root, file) {
  const meshes = [];
  root.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  for (const node of meshes) {
    // One More Rep is flat shaded and ships without normals: unweld to get hard edges back.
    if (!node.geometry.attributes.normal) {
      node.geometry = node.geometry.toNonIndexed();
      node.geometry.computeVertexNormals();
    }
    const source = Array.isArray(node.material) ? node.material : [node.material];
    const next = source.map((material) => {
      if (TEXTURED.has(file)) {
        const map = material?.map || null;
        if (map) {
          map.colorSpace = THREE.SRGBColorSpace;
          map.flipY = false;
          map.needsUpdate = true;
        }
        return new THREE.MeshToonMaterial({
          name: material?.name || "colormap",
          map,
          color: 0xffffff,
          gradientMap: ramp,
          side: material?.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide,
        });
      }
      const name = material?.name || "_defaultMat";
      const look = PALETTE[name] || PALETTE._defaultMat;
      return new THREE.MeshToonMaterial({
        name,
        color: look.color,
        gradientMap: ramp,
        transparent: Boolean(look.transparent),
        opacity: look.opacity ?? 1,
        emissive: look.emissive || 0x000000,
        emissiveIntensity: look.emissiveIntensity || 0,
      });
    });
    node.material = Array.isArray(node.material) ? next : next[0];
    node.castShadow = true;
    node.receiveShadow = true;
    if (OUTLINED.has(file) && !next[0].transparent) addOutline(node, edgeColor(next[0].color.getHex(), 0.66, 0.45));
  }
}

function prepare(root, file) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.userData.size = size;
  recolor(root, file);
  return root;
}

// Parses a few files at once so texture decodes overlap without one long
// main-thread stall.
const PARSE_LANES = 4;

export function createLibrary() {
  const templates = new Map();
  const loader = new GLTFLoader();
  let settled = false;
  let done = 0;
  const parse = (buffer) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("parse timeout")), 8000);
    loader.parse(buffer, "", (parsed) => {
      clearTimeout(timer);
      resolve(parsed);
    }, (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
  const ready = (async () => {
    // Start every download at once: each await can sit behind a render frame,
    // so fetching one file at a time pays that wait per file.
    const buffers = FILES.map((name) => fetch(`/office/assets/kenney/${name}.glb`).then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.arrayBuffer();
    }));
    // A failed download is reported when its lane reaches it, not as unhandled.
    for (const buffer of buffers) buffer.catch(() => {});
    let next = 0;
    async function lane() {
      while (next < FILES.length) {
        const index = next++;
        const name = FILES[index];
        try {
          const gltf = await parse(await buffers[index]);
          templates.set(name, prepare(gltf.scene, name));
        } catch (error) {
          console.warn("kenney", name, error && error.message ? error.message : error);
        }
        done += 1;
      }
    }
    await Promise.all(Array.from({ length: PARSE_LANES }, lane));
    settled = true;
    return templates;
  })();

  function take(name, boxW, boxH, opts = {}) {
    const src = templates.get(name);
    if (!src) return null;
    const size = src.userData.size;
    if (!size || size.x < 0.001 || size.y < 0.001 || size.z < 0.001) return null;
    const model = src.clone(true);
    const maxH = opts.maxHeight || Infinity;
    const stretch = opts.stretch || 1;
    const base = Math.min(boxW / size.x, boxH / size.z, maxH / size.y);
    const sx = Math.min(boxW / size.x, base * stretch);
    const sz = Math.min(boxH / size.z, base * stretch);
    const sy = Math.min(base, maxH / size.y);
    const wrap = new THREE.Group();
    wrap.add(model);
    wrap.scale.set(sx, sy, sz);
    wrap.position.y = opts.lift || 0;
    if (opts.yaw) wrap.rotation.y = opts.yaw;
    wrap.userData.kenney = name;
    wrap.userData.fit = { sx, sy, sz, size };
    return wrap;
  }

  return {
    ready,
    get settled() {
      return settled;
    },
    get progress() {
      return { done, total: FILES.length };
    },
    has(name) {
      return templates.has(name);
    },
    take,
  };
}
