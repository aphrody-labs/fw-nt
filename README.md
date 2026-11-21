# fw-nt

The Windows NT layer of the fw stack: the forks it builds on, pinned as shallow submodules, and the tools that keep them current.

## Why

The goal is a complete, free NT operating system in the spirit of [LiberNT](https://github.com/LiberNT/LiberNT), built on the [Asterinas](https://github.com/asterinas/asterinas) framekernel model, with native C++ on MSVC, modern C and assembly, Rust, .NET 10/11, Bun and WebAssembly where isolation pays. Today this repository holds the fork manifest, the sync and watch tooling and the layer map; fw-nt code replaces a fork's layer only with a working, tested unit.

## Install

```sh
git clone --recurse-submodules --shallow-submodules https://github.com/aphrody-labs/fw-nt.git
```

Needs Bun and `gh`. `just doctor` checks MSVC, the Windows SDK, .NET 10/11, the Rust targets, Bun, clang, CMake and Ninja against `toolchain.toml`.

## Usage

```sh
just sync    # forks fast-forwarded from upstream, gitlinks bumped
just check   # forks or gitlinks behind upstream (exit 1 on drift)
just watch   # upstream activity snapshot into docs/activity/
```

## Documentation

- [docs/architecture.md](docs/architecture.md): layer map.
- [forks.toml](forks.toml): the forks (one shallow submodule each under `third_party/`).
- [docs/activity/](docs/activity/): generated upstream activity.
- [AGENTS.md](AGENTS.md): tools and rules for agents.

## Development

```sh
just test    # bun test ./tools/
```

## License

Apache-2.0, see [LICENSE](LICENSE). Each fork under `third_party/` keeps its upstream licence.
