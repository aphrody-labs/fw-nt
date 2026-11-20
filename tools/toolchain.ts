#!/usr/bin/env bun
// Discovers the installed toolchains live and compares them with toolchain.toml. Exit 1 when one is missing or too old.
// Usage: bun tools/toolchain.ts [--json]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

/** Numeric compare of dotted versions: <0, 0, >0. */
export function cmp(a: string, b: string): number {
  const x = a.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const y = b.split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** First dotted version found in a tool's output. */
export const firstVersion = (s: string) => s.match(/\d+\.\d+(?:\.\d+)*/)?.[0];

const sh = (cmd: string[], env?: Record<string, string>) => {
  try {
    const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
    return p.exitCode === 0 ? `${p.stdout}${p.stderr}`.trim() : "";
  } catch {
    return "";
  }
};

type Row = { tool: string; want: string; have: string; ok: boolean };

function discover(): Row[] {
  const spec = Bun.TOML.parse(readFileSync(join(root, "toolchain.toml"), "utf8")) as Record<string, { min: string | string[]; targets?: string[] }>;
  const rows: Row[] = [];
  const add = (tool: string, want: string, have: string | undefined) => rows.push({ tool, want, have: have ?? "missing", ok: !!have && cmp(have, want) >= 0 });

  // MSVC + Windows SDK through vswhere (the only supported discovery path for Visual Studio).
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const vswhere = join(pf86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  const vs = existsSync(vswhere) ? sh([vswhere, "-latest", "-prerelease", "-products", "*", "-property", "installationPath"]) : "";
  const msvcDir = vs ? join(vs, "VC", "Tools", "MSVC") : "";
  const msvc = msvcDir && existsSync(msvcDir) ? readdirSync(msvcDir).sort(cmp).at(-1) : undefined;
  add("msvc", String(spec.msvc.min), msvc);
  const kits = join(pf86, "Windows Kits", "10", "Include");
  const sdk = existsSync(kits) ? readdirSync(kits).filter((d) => /^\d+\./.test(d)).sort(cmp).at(-1) : undefined;
  add("windows_sdk", String(spec.windows_sdk.min), sdk);

  const sdks = sh(["dotnet", "--list-sdks"]).split(/\r?\n/).map((l) => firstVersion(l)).filter(Boolean) as string[];
  for (const m of [spec.dotnet.min].flat()) add(`dotnet ${m}`, m, sdks.filter((v) => v.startsWith(`${m.split(".")[0]}.`)).sort(cmp).at(-1));

  add("rust", String(spec.rust.min), firstVersion(sh(["rustc", "-V"])));
  const installed = new Set(sh(["rustup", "target", "list", "--installed"]).split(/\r?\n/).map((s) => s.trim()));
  for (const t of spec.rust.targets ?? []) rows.push({ tool: `rust target ${t}`, want: "installed", have: installed.has(t) ? "installed" : "missing", ok: installed.has(t) });

  add("bun", String(spec.bun.min), firstVersion(sh(["bun", "--version"])));
  add("clang", String(spec.clang.min), firstVersion(sh(["clang-cl", "--version"]).replace(/^.*?version/s, "")));
  add("cmake", String(spec.cmake.min), firstVersion(sh(["cmake", "--version"])));
  add("ninja", String(spec.ninja.min), firstVersion(sh(["ninja", "--version"])));
  return rows;
}

if (import.meta.main) {
  const rows = discover();
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.tool.padEnd(36)} have ${r.have.padEnd(16)} want >= ${r.want}`);
  if (rows.some((r) => !r.ok)) process.exit(1);
}
