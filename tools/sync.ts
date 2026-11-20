#!/usr/bin/env bun
// Fast-forwards every fork of forks.toml from its upstream (GitHub merge-upstream), then points each gitlink of
// third_party/<name> at the fork's branch head read with `git ls-remote` (no clone, so CI stays light even for dotnet).
// A fork with `patched` carries a patch queue (tools/patchq.ts): its generated branch `patched` is `branch` plus the series
// of the fork's `patches` branch, rebuilt after the mirror step and pinned by the gitlink instead of `branch`.
// Usage: bun tools/sync.ts [--check]   --check: report only, exit 1 when a fork or a gitlink is behind.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildPatched, dispose, pushPatched } from "./patchq.ts";

type Fork = { name: string; upstream: string; branch: string; lang: string; role: string; patched?: string; patches?: string };
const pinned = (f: Fork) => f.patched ?? f.branch;
const root = resolve(import.meta.dir, "..");
const forks = (Bun.TOML.parse(readFileSync(join(root, "forks.toml"), "utf8")) as { fork: Fork[] }).fork;
const check = process.argv.includes("--check");

const run = (cmd: string[], cwd = root) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
};
const owner = run(["gh", "repo", "view", "--json", "owner", "-q", ".owner.login"]).out || "aphrody-labs";
const slug = run(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).out || `${owner}/fw-nt`;

// One open issue per title prefix: created, or its title and body updated; `resolve` closes the ones whose cause is gone.
function openIssues(prefix: string): { number: number; title: string }[] {
  const r = run(["gh", "issue", "list", "-R", slug, "--state", "open", "--search", `"${prefix}" in:title`, "--json", "number,title", "--limit", "50"]);
  return (r.ok ? (JSON.parse(r.out || "[]") as { number: number; title: string }[]) : []).filter((i) => i.title.startsWith(prefix));
}
function upsertIssue(prefix: string, title: string, body: string) {
  const hit = openIssues(prefix)[0];
  if (hit) return run(["gh", "issue", "edit", String(hit.number), "-R", slug, "--title", title, "--body", body]).ok ? `issue #${hit.number} updated` : "issue update failed";
  const r = run(["gh", "issue", "create", "-R", slug, "--title", title, "--body", body]);
  return r.ok ? `issue opened ${r.out}` : `issue not opened: ${r.err.split("\n").at(-1)}`;
}
const closeIssues = (match: (title: string) => boolean, why: string, prefix: string) =>
  openIssues(prefix).filter((i) => match(i.title)).forEach((i) => run(["gh", "issue", "close", String(i.number), "-R", slug, "--comment", why]));

// Rebuilds the generated branch of a patched fork; pushes it only when it moved. Returns the report column and whether the run fails.
function patchQueue(f: Fork, repo: string): { note: string; fail: boolean; stale: boolean } {
  const url = `https://github.com/${repo}.git`;
  const old = run(["git", "ls-remote", url, `refs/heads/${f.patched}`]).out.split(/\s+/)[0] ?? "";
  let q;
  try {
    q = buildPatched(url, f.branch, url, f.patches ?? "patches");
  } catch (e) {
    return { note: `patch queue not built: ${(e as Error).message}`, fail: true, stale: false };
  }
  try {
    const head = q.mainSha.slice(0, 10);
    const conflict = `${f.name} patch `;
    if (q.failed) {
      const prefix = `${conflict}${q.failed.patch} conflicts with upstream`;
      const body = `The series of \`${repo}\` branch \`${f.patches}\` no longer applies to \`${f.branch}\` at ${q.mainSha}.\n\nPatch: \`${q.failed.patch}\`\n\n\`\`\`\n${q.failed.reason}\n\`\`\`\n\n\`${f.patched}\` and the gitlink stay at ${old || "(none)"} until the patch is rebased.`;
      const issue = check ? "" : `, ${upsertIssue(prefix, `${prefix} ${head}`, body)}`;
      return { note: `CONFLICT ${q.failed.patch} on ${head}, ${f.patched} kept at ${old.slice(0, 10) || "(none)"}${issue}`, fail: true, stale: false };
    }
    if (!check) closeIssues((t) => t.includes(" conflicts with upstream"), `Series applies again on ${q.mainSha}.`, conflict);
    const merged = q.applied.filter((a) => a.status === "merged").map((a) => a.patch);
    if (!check) {
      for (const p of merged) {
        const prefix = `${conflict}${p} already upstream`;
        upsertIssue(prefix, `${prefix}: remove from the series`, `\`${p}\` applies in reverse on \`${f.branch}\` at ${q.mainSha}: its change is upstream. It was skipped in \`${f.patched}\`; remove it from \`${f.patches}/patches/series\`.`);
      }
      closeIssues((t) => t.includes(" already upstream") && !merged.some((p) => t.startsWith(`${conflict}${p} `)), "Patch is no longer merged upstream or left the series.", conflict);
    }
    const parts = [`${q.applied.length - merged.length} applied`, ...(merged.length ? [`merged: ${merged.join(", ")}`] : [])];
    if (q.head === old) return { note: `${f.patched} unchanged (${parts.join(", ")})`, fail: false, stale: false };
    if (check) return { note: `${f.patched} stale ${old.slice(0, 10) || "(none)"} -> ${q.head!.slice(0, 10)}`, fail: false, stale: true };
    const push = pushPatched(q, url, f.patched!, old, ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"]);
    if (!push.ok) return { note: `${f.patched} push failed: ${push.err.split("\n").at(-1)}`, fail: true, stale: false };
    return { note: `${f.patched} pushed ${old.slice(0, 10) || "(none)"} -> ${q.head!.slice(0, 10)} (${parts.join(", ")})`, fail: false, stale: false };
  } finally {
    dispose(q);
  }
}

// The manifest and .gitmodules must agree on path, relative URL and branch of every fork (local, no network).
let drift = 0;
for (const f of forks) {
  const key = `submodule.third_party/${f.name}`;
  const get = (k: string) => run(["git", "config", "-f", ".gitmodules", "--get", `${key}.${k}`]).out;
  const want = { url: `../${f.name}.git`, branch: pinned(f) };
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
let failed = 0;
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
    let queue = "";
    let hold = false;
    if (f.patched) {
      const r = patchQueue(f, repo);
      queue = `\t${r.note}`;
      hold = r.fail;
      if (r.fail) failed++;
      if (r.stale) stale++;
    }
    const cmp = run(["gh", "api", `repos/${repo}/compare/${f.branch}...${f.upstream.split("/")[0]}:${f.branch}`, "--jq", ".ahead_by"]);
    const behind = Number(cmp.out || "0");
    const head = run(["git", "ls-remote", `https://github.com/${repo}.git`, `refs/heads/${pinned(f)}`]).out.split(/\s+/)[0];
    const path = `third_party/${f.name}`;
    const cur = run(["git", "ls-files", "-s", "--", path]).out.split(/\s+/)[1];
    let link = "ok";
    if (hold) link = `kept ${cur?.slice(0, 10)}`;
    else if (head && cur !== head) {
      if (check) link = `stale ${cur?.slice(0, 10)} -> ${head.slice(0, 10)}`;
      else {
        const u = run(["git", "update-index", "--cacheinfo", `160000,${head},${path}`]);
        link = u.ok ? `bumped ${cur?.slice(0, 10)} -> ${head.slice(0, 10)}` : `bump failed: ${u.err}`;
      }
    }
    if (behind > 0 || link.startsWith("stale") || sync.startsWith("sync failed")) stale++;
    return `${f.name}\t${sync}\tbehind_upstream=${behind}\t${link}${queue}`;
  }),
);
console.log(rows.join("\n"));
if (failed || (check && stale)) process.exit(1);
