import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPatched, dispose, git, parseSeries, pushPatched, upstreamStatus } from "./patchq.ts";

const root = mkdtempSync(join(tmpdir(), "patchq-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };
const must = (r: { ok: boolean; err: string }) => {
  if (!r.ok) throw new Error(r.err);
  return r;
};
const url = (p: string) => pathToFileURL(p).href;

/** A repo on `branch` with the given files committed one commit per entry. */
function repo(name: string, branch: string, commits: Record<string, string>[]) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  must(git(dir, ["init", "-q", "-b", branch]));
  commits.forEach((files, i) => {
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      writeFileSync(join(dir, f), text);
    }
    must(git(dir, ["add", "-A"], ID));
    must(git(dir, ["commit", "-q", "-m", `c${i}`], ID));
  });
  return dir;
}

/** `git format-patch` of a change made in a scratch clone of `upstream`: returns the mbox text. */
function patchOf(upstream: string, subject: string, files: Record<string, string>, status = "carry") {
  const scratch = join(root, `scratch-${Math.random().toString(36).slice(2)}`);
  must(git(root, ["clone", "-q", upstream, scratch]));
  for (const [f, text] of Object.entries(files)) writeFileSync(join(scratch, f), text);
  must(git(scratch, ["add", "-A"], ID));
  must(git(scratch, ["commit", "-q", "-m", `${subject}\n\nUpstream-Status: ${status}`], ID));
  return must(git(scratch, ["format-patch", "-1", "--stdout"], ID)).out + "\n";
}

/** A `patches` branch repo holding patches/series and the named patches. */
function patchesRepo(name: string, patches: Record<string, string>) {
  const files: Record<string, string> = { "patches/series": "# series\n" + Object.keys(patches).join("\n") + "\n" };
  for (const [n, t] of Object.entries(patches)) files[`patches/${n}`] = t;
  return repo(name, "patches", [files]);
}

test("parseSeries skips comments and blanks, upstreamStatus reads the header", () => {
  expect(parseSeries("# a\n\n0001-x.patch\r\n  0002-y.patch  \n")).toEqual(["0001-x.patch", "0002-y.patch"]);
  expect(upstreamStatus("Subject: x\n\nUpstream-Status: submitted https://e/1\n---\n")).toBe("submitted https://e/1");
  expect(upstreamStatus("Subject: x")).toBe("");
});

test("a clean series builds the same head twice and carries the change", () => {
  const up = repo("up1", "main", [{ "a.txt": "one\ntwo\nthree\n" }]);
  const p = patchOf(up, "add four", { "a.txt": "one\ntwo\nthree\nfour\n" });
  const pr = patchesRepo("pr1", { "0001-four.patch": p });
  const a = buildPatched(url(up), "main", url(pr), "patches");
  const b = buildPatched(url(up), "main", url(pr), "patches");
  expect(a.failed).toBeUndefined();
  expect(a.applied.map((x) => [x.patch, x.status, x.upstream])).toEqual([["0001-four.patch", "applied", "carry"]]);
  expect(a.head).toBeDefined();
  expect(a.head).not.toBe(a.mainSha);
  expect(a.head).toBe(b.head);
  expect(git(join(a.dir, "src"), ["show", "HEAD:a.txt"]).out).toContain("four");
  dispose(a);
  dispose(b);
});

test("a conflicting patch fails the queue and names the patch, no head", () => {
  const up = repo("up2", "main", [{ "a.txt": "one\ntwo\nthree\n" }]);
  const p = patchOf(up, "edit two", { "a.txt": "one\nTWO\nthree\n" });
  // upstream rewrites the same line differently after the patch was made
  repo("up2", "main", [{ "a.txt": "one\ndeux\nthree\n" }]);
  const pr = patchesRepo("pr2", { "0001-edit.patch": p });
  const q = buildPatched(url(up), "main", url(pr), "patches");
  expect(q.head).toBeUndefined();
  expect(q.failed?.patch).toBe("0001-edit.patch");
  dispose(q);
});

test("a patch already in main is reported merged and the rest still applies", () => {
  const up = repo("up3", "main", [{ "a.txt": "one\ntwo\n", "b.txt": "b\n" }]);
  const p1 = patchOf(up, "add three", { "a.txt": "one\ntwo\nthree\n" });
  const p2 = patchOf(up, "edit b", { "b.txt": "b2\n" });
  // upstream took the first change as it is
  repo("up3", "main", [{ "a.txt": "one\ntwo\nthree\n" }]);
  const pr = patchesRepo("pr3", { "0001-three.patch": p1, "0002-b.patch": p2 });
  const q = buildPatched(url(up), "main", url(pr), "patches");
  expect(q.failed).toBeUndefined();
  expect(q.applied.map((x) => [x.patch, x.status])).toEqual([["0001-three.patch", "merged"], ["0002-b.patch", "applied"]]);
  expect(git(join(q.dir, "src"), ["show", "HEAD:b.txt"]).out).toBe("b2");
  dispose(q);
});

test("pushPatched honours the lease: first push, then a stale expectation is refused", () => {
  const up = repo("up4", "main", [{ "a.txt": "x\n" }]);
  const p = patchOf(up, "add y", { "a.txt": "x\ny\n" });
  const pr = patchesRepo("pr4", { "0001-y.patch": p });
  const remote = join(root, "remote4.git");
  must(git(root, ["init", "-q", "--bare", remote]));
  const q = buildPatched(url(up), "main", url(pr), "patches");
  expect(pushPatched(q, url(remote), "aphrody", "").ok).toBe(true);
  expect(git(remote, ["rev-parse", "refs/heads/aphrody"]).out).toBe(q.head!);
  // a second, different head, pushed while the caller still believes the branch is absent
  const p2 = patchOf(up, "add z", { "a.txt": "x\nz\n" });
  const q2 = buildPatched(url(up), "main", url(patchesRepo("pr4b", { "0001-z.patch": p2 })), "patches");
  expect(pushPatched(q2, url(remote), "aphrody", "").ok).toBe(false);
  expect(pushPatched(q2, url(remote), "aphrody", q.head!).ok).toBe(true);
  expect(git(remote, ["rev-parse", "refs/heads/aphrody"]).out).toBe(q2.head!);
  dispose(q);
  dispose(q2);
});
