#!/usr/bin/env bun
// Fast-forwards every fork of forks.toml from its upstream (GitHub merge-upstream), then points each gitlink of
// third_party/<name> at the fork's branch head read with `git ls-remote` (no clone, so CI stays light even for dotnet).
// Usage: bun tools/sync.ts [--check]   --check: report only, exit 1 when a fork or a gitlink is behind.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Fork = { name: string; upstream: string; branch: string; lang: string; role: string };
const root = resolve(import.meta.dir, "..");
const forks = (Bun.TOML.parse(readFileSync(join(root, "forks.toml"), "utf8")) as { fork: Fork[] }).fork;
const check = process.argv.includes("--check");

const run = (cmd: string[], cwd = root) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
};
const owner = run(["gh", "repo", "view", "--json", "owner", "-q", ".owner.login"]).out || "aphrody-labs";

// The manifest and .gitmodules must agree on path, relative URL and branch of every fork (local, no network).
let drift = 0;
for (const f of forks) {
  const key = `submodule.third_party/${f.name}`;
  const get = (k: string) => run(["git", "config", "-f", ".gitmodules", "--get", `${key}.${k}`]).out;
  const want = { url: `../${f.name}.git`, branch: f.branch };
  for (const [k, v] of Object.entries(want)) if (get(k) !== v) {
    drift++;
    console.log(`DRIFT .gitmodules ${key}.${k} = ${get(k) || "(unset)"}, forks.toml says ${v}`);
  }
}
if (check && drift) process.exitCode = 1;

// --ensure: every fork exists in the org (created from its upstream, unarchived) and has its shallow submodule.
if (process.argv.includes("--ensure")) {
  for (const f of forks) {
    const repo = `${owner}/${f.name}`;
    const info = run(["gh", "api", `repos/${repo}`, "--jq", "[.fork, .archived, (.parent.full_name // \"\")] | @tsv"]);
    if (!info.ok) {
      const r = run(["gh", "repo", "fork", f.upstream, "--org", owner, "--fork-name", f.name, "--clone=false", "--default-branch-only"]);
      console.log(`fork  ${repo} <- ${f.upstream}: ${r.ok ? "created" : r.err.split("\n").at(-1)}`);
    } else {
      const [, archived, parent] = info.out.split("\t");
      if (parent && parent.toLowerCase() !== f.upstream.toLowerCase()) console.log(`WARN  ${repo} parent is ${parent}, manifest says ${f.upstream}`);
      if (archived === "true") console.log(`unarchive ${repo}: ${run(["gh", "repo", "unarchive", repo, "--yes"]).ok ? "ok" : "failed"}`);
    }
    const path = `third_party/${f.name}`;
    if (!run(["git", "ls-files", "-s", "--", path]).out) {
      const r = run(["git", "submodule", "add", "--depth", "1", "-b", f.branch, `../${f.name}.git`, path]);
      run(["git", "config", "-f", ".gitmodules", `submodule.${path}.shallow`, "true"]);
      console.log(`submodule ${path}: ${r.ok ? "added" : r.err.split("\n").at(-1)}`);
    }
  }
}

let stale = 0;
const rows = await Promise.all(
  forks.map(async (f) => {
    const repo = `${owner}/${f.name}`;
    let sync = "skipped";
    if (!check) {
      const r = run(["gh", "repo", "sync", repo, "--branch", f.branch]);
      if (r.ok) sync = "synced";
      else {
        // Fork carries its own patches: let GitHub merge upstream in (merge commit); a conflict stays reported as drift.
        const m = run(["gh", "api", "-X", "POST", `repos/${repo}/merge-upstream`, "-f", `branch=${f.branch}`, "--jq", ".merge_type"]);
        sync = m.ok ? `merged (${m.out})` : `diverged, merge conflict: patches in ${repo} need a manual rebase`;
      }
    }
    const cmp = run(["gh", "api", `repos/${repo}/compare/${f.branch}...${f.upstream.split("/")[0]}:${f.branch}`, "--jq", ".ahead_by"]);
    const behind = Number(cmp.out || "0");
    const head = run(["git", "ls-remote", `https://github.com/${repo}.git`, `refs/heads/${f.branch}`]).out.split(/\s+/)[0];
    const path = `third_party/${f.name}`;
    const cur = run(["git", "ls-files", "-s", "--", path]).out.split(/\s+/)[1];
    let link = "ok";
    if (head && cur !== head) {
      if (check) link = `stale ${cur?.slice(0, 10)} -> ${head.slice(0, 10)}`;
      else {
        const u = run(["git", "update-index", "--cacheinfo", `160000,${head},${path}`]);
        link = u.ok ? `bumped ${cur?.slice(0, 10)} -> ${head.slice(0, 10)}` : `bump failed: ${u.err}`;
      }
    }
    if (behind > 0 || link.startsWith("stale") || sync.startsWith("sync failed")) stale++;
    return `${f.name}\t${sync}\tbehind_upstream=${behind}\t${link}`;
  }),
);
console.log(rows.join("\n"));
if (check && stale) process.exit(1);
