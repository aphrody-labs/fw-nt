# AGENTS.md

`fw-nt` is the Windows NT layer of the stack around `fw` (toolchain and agent runtime): the forks of the NT-side projects (shell, terminal,
Win32/WinRT projection, .NET runtime and its JavaScript bridge, remote desktop, desktop computer use for agents, and the kernel, driver and
graphics bases listed in `docs/architecture.md`) and the tools that keep them current.

## Layout
- `forks.toml`: the single manifest of the forks (name, upstream, branch, language, role).
- `third_party/<name>`: one shallow submodule per fork, URL `../<name>.git` (relative to `aphrody-labs`), one checkout each.
- `tools/sync.ts`: fast-forwards each fork from its upstream and bumps the gitlinks; `--check` reports drift; `--ensure` first creates or unarchives missing forks and adds their submodules.
- `tools/patchq.ts`: patch queue of a fork with `patched`/`patches` in `forks.toml` (kiri): the generated branch is the fork `main` plus the series of its `patches` branch (`git am --3way`). A patch that applies in reverse is reported merged; any other failure keeps the last good head and gitlink, opens one issue and fails the run.
- `tools/watch.ts`: upstream activity (issues, PRs, discussions, releases) of every fork and of the most recently pushed Microsoft repositories into `docs/activity/` (`latest.md`, `upstreams.tsv`, `microsoft-recent.tsv`; generated, do not edit).
- `tools/toolchain.ts`: toolchains against `toolchain.toml`.
- `.github/workflows/sync.yml`: sync and watch every 6 hours (App token), committing to `main`.

## Rules
- Assemble first: patches go into the fork (`aphrody-labs/<name>`), never copied into this tree.
- Add a fork: add it to `forks.toml`, then `bun tools/sync.ts --ensure` (creates it in `aphrody-labs` and adds `third_party/<name>`).
- Heavy builds (dotnet VMR, Intelligent Terminal, PowerShell) run on the build host, never on the workstation.
- Git: work on `main`, no branches, worktrees, stash or reset. Message format and attribution: the org standard, [aphrody-labs/.github](https://github.com/aphrody-labs/.github) (`docs/standards/commit-format.md`).
- Versions and heads are read live (`gh api`, `git ls-remote`); nothing hardcoded.
