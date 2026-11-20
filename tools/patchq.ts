// Patch queue of a patched fork: the generated branch is `main` of the fork plus the series of its patches branch,
// applied with `git am --3way`. Pure git, no network beyond the two URLs it is given (file:// URLs in the tests).
//   patches branch:  patches/series (one file name per line, `#` comments) and patches/*.patch (git format-patch)
//   result:          one commit per patch on top of main; author and committer dates are the patches', the committer
//                    is fixed, so the same main and series always give the same head (no push when nothing moved).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Applied = { patch: string; status: "applied" | "merged"; upstream: string };
export type Failed = { patch: string; reason: string };
export type Queue = {
  dir: string; // clone holding the result (HEAD = generated head); the caller removes it with `dispose`
  mainSha: string;
  head?: string;
  applied: Applied[];
  failed?: Failed;
};

const IDENTITY = { GIT_COMMITTER_NAME: "aphrody-patchq", GIT_COMMITTER_EMAIL: "patchq@users.noreply.github.com" };

export const git = (cwd: string, args: string[], env: Record<string, string> = {}) => {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...IDENTITY, GIT_TERMINAL_PROMPT: "0", ...env } });
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim(), err: p.stderr.toString().trim() };
};

export const parseSeries = (text: string) =>
  text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

/** `Upstream-Status: carry | submitted <url> | merged <tag>` of a patch header (first line, empty when absent). */
export const upstreamStatus = (patch: string) => /^Upstream-Status:[ \t]*(.+)$/m.exec(patch)?.[1].trim() ?? "";

export const dispose = (q: Queue) => rmSync(q.dir, { recursive: true, force: true });

/** One attempt at a given clone depth (0 = full history, which a patch needs when its 3-way base blob is missing). */
function attempt(mainUrl: string, mainBranch: string, patchesUrl: string, patchesBranch: string, depth: number): Queue {
  const dir = mkdtempSync(join(tmpdir(), "patchq-"));
  const src = join(dir, "src");
  const pat = join(dir, "patches");
  const shallow = depth ? ["--depth", String(depth)] : [];
  const must = (r: { ok: boolean; err: string }, what: string) => {
    if (!r.ok) throw new Error(`${what}: ${r.err}`);
  };
  must(git(dir, ["clone", "-q", ...shallow, "--single-branch", "--branch", mainBranch, mainUrl, src]), `clone ${mainUrl}@${mainBranch}`);
  must(git(dir, ["clone", "-q", "--depth", "1", "--single-branch", "--branch", patchesBranch, patchesUrl, pat]), `clone ${patchesUrl}@${patchesBranch}`);
  const q: Queue = { dir, mainSha: git(src, ["rev-parse", "HEAD"]).out, applied: [] };
  const series = parseSeries(readFileSync(join(pat, "patches", "series"), "utf8"));
  git(src, ["config", "user.name", IDENTITY.GIT_COMMITTER_NAME]);
  git(src, ["config", "user.email", IDENTITY.GIT_COMMITTER_EMAIL]);
  for (const name of series) {
    const file = join(pat, "patches", name);
    const text = readFileSync(file, "utf8");
    const upstream = upstreamStatus(text);
    const before = git(src, ["rev-parse", "HEAD"]).out;
    const am = git(src, ["am", "--3way", "--committer-date-is-author-date", file]);
    if (am.ok) {
      // "No changes -- Patch already applied" exits 0 without a commit: that change is in main already.
      const moved = git(src, ["rev-parse", "HEAD"]).out !== before;
      q.applied.push({ patch: name, status: moved ? "applied" : "merged", upstream });
      continue;
    }
    git(src, ["am", "--abort"]);
    // Does not apply forward but applies in reverse: its change is already in main.
    if (git(src, ["apply", "--check", "-R", file]).ok) {
      q.applied.push({ patch: name, status: "merged", upstream });
      continue;
    }
    q.failed = { patch: name, reason: (am.err || am.out).split("\n").slice(-4).join(" | ") };
    return q;
  }
  q.head = git(src, ["rev-parse", "HEAD"]).out;
  return q;
}

/** Builds the generated branch in a temporary clone; a conflict is retried once on full history before it counts. */
export function buildPatched(mainUrl: string, mainBranch: string, patchesUrl: string, patchesBranch: string, depth = 100): Queue {
  let q = attempt(mainUrl, mainBranch, patchesUrl, patchesBranch, depth);
  if (q.failed && depth) {
    dispose(q);
    q = attempt(mainUrl, mainBranch, patchesUrl, patchesBranch, 0);
  }
  return q;
}

/** Directory of the clone's work tree. */
export const srcDir = (q: Queue) => join(q.dir, "src");

/** Force-pushes HEAD to `branch` of `url` only when the remote is still at `expected` ("" = branch absent). */
export function pushPatched(q: Queue, url: string, branch: string, expected: string, extra: string[] = []) {
  return git(srcDir(q), [...extra, "push", "-q", `--force-with-lease=refs/heads/${branch}:${expected}`, url, `HEAD:refs/heads/${branch}`]);
}
