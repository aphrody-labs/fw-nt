# fw-nt architecture

Goal: a complete, free NT operating system in the spirit of [LiberNT](https://github.com/LiberNT/LiberNT) (NT10 / Windows 11
compatibility), rebuilt with native toolchains only: C++ on MSVC, modern C, assembly, Rust, .NET 10/11, Bun, and WebAssembly
where isolation pays. Design model: [Asterinas](https://github.com/asterinas/asterinas) framekernel: a small audited unsafe core
(OSTD) and every other kernel service in safe code on top of it.

Every component starts from a fork in `forks.toml` (`third_party/<name>`); fw-nt code replaces a layer only with a working,
tested unit, LiberNT first rules apply (provide every symbol of the new implementation, then drop the old files).

## Layers

| Layer | Language and toolchain | Base forks | Notes |
|---|---|---|---|
| Boot (UEFI, FreeLoader) | Rust `x86_64/aarch64-unknown-uefi`, assembly (ml64, armasm64) | LiberNT `boot/` | UEFI loader in Rust; FreeLoader kept until parity |
| Kernel core (Ke, HAL, trap, MMU) | C++23 MSVC `/kernel`, C23, assembly | LiberNT `ntos/ke`, `hal/`; Asterinas OSTD (model) | framekernel: only this core holds `unsafe`/raw hardware access |
| Kernel services (Mm, Cc, Io, Ob, Ps, Se) | Rust `no_std` on the core, C++ where LiberNT already has clean-room NT10 code | LiberNT `ntos/mm` (NVS), `ntos/cc` | Asterinas service split, NT object semantics |
| Drivers (KMDF/UMDF, WDDM, storage, net) | Rust (windows-drivers-rs, cargo-wdk), C++ MSVC | windows-drivers-rs, LiberNT `drivers/` | WDK headers from the Windows SDK/WDK |
| Graphics kernel + composition | C++ MSVC | LiberNT `dxgkrnl`, `dwm`; DirectX-Headers | D3D11/D3D12 user-mode drivers |
| D3D11/D3D12 runtime on Vulkan GPUs | C/C++ | dxvk, vkd3d-proton, DirectXShaderCompiler, DirectXTK12 | path for GPUs without a native WDDM driver |
| WebGPU / 2D | Rust, C++ | wgpu, dawn, skia | wgpu for Rust services, Dawn + Skia for the compositor and web |
| Linux GUI subsystem | C, C++ | weston-mirror, wslg, FreeRDP via IronRDP | Wayland/X11 apps over RDP as in WSLg |
| Win32 userland compat cross-check | C | wine-cachyos, proton-cachyos | reference behaviour for Win32 APIs and D3D translation |
| Native APIs for Rust | Rust | windows-rs | Win32/COM/WinRT projection |
| UI framework and app model | C++ (WinUI 3), C# | microsoft-ui-xaml, WindowsAppSDK | desktop shell base |
| Design system | TypeScript, React, React Native | fluentui, fluentui-system-icons, react-native-windows | Fluent everywhere: shell, web, RN apps |
| Managed runtime | C# .NET 10 LTS + 11, NativeAOT | dotnet (VMR), node-api-dotnet | system services, PowerShell, JS bridge |
| Shells and terminal | C#, Rust, C++ | PowerShell, niubash, rubash, ruline, WinuxCmd, niu-git, intelligent-terminal | console host with ACP agent panes |
| Agents and remote | TypeScript (Bun), Rust | agent-desktop, IronRDP | computer use and RDP for agents |
| Virtualization and containers | Rust | openvmm, kiri | Hyper-V class VMM/paravisor, container runtime |
| Sandboxed extensions | Rust/C/C++ to `wasm32-wasip2` | wgpu/dawn (WebGPU) | WebAssembly components for untrusted extensions |

## Tracking
- `bun tools/sync.ts --ensure`: forks exist (created, unarchived), submodules present, forks fast-forwarded, gitlinks bumped.
- `bun tools/watch.ts`: issues, PRs, discussions, forks, releases of every upstream and of the 60 most recently pushed Microsoft
  repositories into `docs/activity/` (newest items in `latest.md`).
- `bun tools/toolchain.ts`: MSVC, Windows SDK, .NET 10/11, Rust and its NT/UEFI/wasm targets, Bun, clang, CMake, Ninja.
- The workflow `.github/workflows/sync.yml` runs sync and watch every 6 hours and commits to `main`.
