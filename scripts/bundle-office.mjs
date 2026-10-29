import * as esbuild from "esbuild";
import { stampAssets } from "./stamp-assets.mjs";

const externalThree = {
  name: "external-three-core",
  setup(build) {
    build.onResolve({ filter: /^three$/ }, () => ({ path: "three", external: true }));
  },
};

// three.js itself, minified; the license header stays at the end of the file.
await esbuild.build({
  entryPoints: ["node_modules/three/build/three.module.js"],
  format: "esm",
  minify: true,
  outfile: "public/office/vendor/three.module.js",
});

await esbuild.build({
  entryPoints: ["scripts/office-extras.mjs"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "public/office/vendor/extras.js",
  plugins: [externalThree],
});

await esbuild.build({
  entryPoints: ["scripts/office-gltf.mjs"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "public/office/vendor/gltf.js",
  plugins: [externalThree],
});

stampAssets();
