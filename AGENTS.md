# AGENTS.md

`fw-nt` is the Windows NT layer of the stack around `fw` (toolchain and agent runtime): the shell, the terminal, the Win32/WinRT
projection, the .NET runtime and its JavaScript bridge, remote desktop and desktop computer use for agents.

## Layout
- `forks.toml`: the single manifest of the forks (name, upstream, branch, language, role).
- `third_party/<name>`: one shallow submodule per fork, URL `../<name>.git` (relative to `aphrody-labs`), one checkout each.
- `tools/sync.ts`: fast-forwards each fork from its upstream and bumps the gitlinks; `--check` reports drift.
- `.github/workflows/sync.yml`: the same sync every 6 hours, committing to `main`.

## Rules
- Assemble first: patches go into the fork (`aphrody-labs/<name>`), never copied into this tree.
- Add a fork: create it in `aphrody-labs`, add it to `forks.toml`, `git submodule add --depth 1 ../<name>.git third_party/<name>`.
- Heavy builds (dotnet VMR, Intelligent Terminal, PowerShell) run on the build host, never on the workstation.
- Work on `main`; no branches, worktrees, stash or reset. No AI attribution in commits.
- Versions and heads are read live (`gh api`, `git ls-remote`); nothing hardcoded.
