import * as esbuild from "esbuild";

const externalThree = {
  name: "external-three-core",
  setup(build) {
    build.onResolve({ filter: /^three$/ }, () => ({ path: "three", external: true }));
  },
};

await esbuild.build({
  entryPoints: ["scripts/office-extras.mjs"],
  bundle: true,
  format: "esm",
  outfile: "public/office/vendor/extras.js",
  plugins: [externalThree],
});

await esbuild.build({
  entryPoints: ["scripts/office-gltf.mjs"],
  bundle: true,
  format: "esm",
  outfile: "public/office/vendor/gltf.js",
  plugins: [externalThree],
});
