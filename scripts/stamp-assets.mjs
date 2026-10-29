/**
 * Vendor files and models are cached for a long time (public/_headers), so
 * their URLs carry a short content hash: a changed file gets a new URL.
 * The import map in public/index.html versions the vendor files and
 * furnish.js versions the models. Run after changing either:
 *   npm run vendor:extras   (rebuilds vendor files, then stamps)
 *   node scripts/stamp-assets.mjs
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = ["three.module.js", "extras.js", "gltf.js"];

const hash = (parts) => {
  const sum = createHash("sha256");
  for (const part of parts) sum.update(part);
  return sum.digest("hex").slice(0, 10);
};

/** The versions the current files should carry. */
export function assetStamps(base = root) {
  const vendor = Object.fromEntries(VENDOR.map((name) => [name, hash([readFileSync(join(base, "public/office/vendor", name))])]));
  const dir = join(base, "public/office/assets/kenney");
  const models = readdirSync(dir).filter((name) => name.endsWith(".glb")).sort();
  const model = hash(models.flatMap((name) => [name, readFileSync(join(dir, name))]));
  return { vendor, model };
}

export function importMap(stamps) {
  const at = (name) => `/office/vendor/${name}?v=${stamps.vendor[name]}`;
  const imports = { three: at("three.module.js") };
  for (const name of VENDOR) imports[`/office/vendor/${name}`] = at(name);
  return JSON.stringify({ imports }, null, 2).replace(/\n/g, "\n  ");
}

const MAP_RE = /(<script type="importmap">\n  )[\s\S]*?(\n  <\/script>)/;
const MODEL_RE = /const MODEL_VERSION = "[^"]*";/;

export function stampAssets(base = root) {
  const stamps = assetStamps(base);
  const htmlFile = join(base, "public/index.html");
  const html = readFileSync(htmlFile, "utf8");
  if (!MAP_RE.test(html)) throw new Error("public/index.html: import map not found");
  writeFileSync(htmlFile, html.replace(MAP_RE, (_, open, close) => `${open}${importMap(stamps)}${close}`));
  const furnishFile = join(base, "public/office/furnish.js");
  const furnish = readFileSync(furnishFile, "utf8");
  if (!MODEL_RE.test(furnish)) throw new Error("furnish.js: MODEL_VERSION not found");
  writeFileSync(furnishFile, furnish.replace(MODEL_RE, `const MODEL_VERSION = "${stamps.model}";`));
  console.log(`stamped vendor ${JSON.stringify(stamps.vendor)} models ${stamps.model}`);
  return stamps;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) stampAssets();
