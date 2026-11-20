# fw-nt

A complete free NT operating system around [fw](https://github.com/aphrody-labs/fw), in the spirit of
[LiberNT](https://github.com/LiberNT/LiberNT) and built on the [Asterinas](https://github.com/asterinas/asterinas) framekernel model:
native C++ on MSVC, modern C and assembly, Rust, .NET 10/11, Bun, and WebAssembly where isolation pays.

- Architecture and layer map: [docs/architecture.md](docs/architecture.md)
- Forks (one shallow submodule each under `third_party/`): [forks.toml](forks.toml)
- Live upstream activity (issues, PRs, discussions, releases): [docs/activity/](docs/activity/)

```sh
git clone --recurse-submodules --shallow-submodules https://github.com/aphrody-labs/fw-nt.git
just doctor  # toolchains: MSVC, Windows SDK, .NET 10/11, Rust targets, Bun, clang, CMake, Ninja
just sync    # forks fast-forwarded from upstream, gitlinks bumped
just watch   # upstream activity snapshot
```
