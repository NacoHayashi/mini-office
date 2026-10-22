/** Version label for the office title, e.g. "v0.5.0 · a1b2c3d". */
import { execFileSync } from "node:child_process";

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/** Cloudflare Workers Builds sets WORKERS_CI_COMMIT_SHA; local builds ask git. */
export function versionLabel(pkgVersion, env = process.env, git = gitCommit) {
  const sha = String(env.WORKERS_CI_COMMIT_SHA || git() || "").trim();
  const commit = /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : "";
  const base = pkgVersion ? `v${pkgVersion}` : "dev";
  return commit ? `${base} · ${commit}` : base;
}
