# fw-nt

Windows NT layer of [fw](https://github.com/aphrody-labs/fw): one monorepo assembling the forks that make Windows an agent desktop.

| Fork | Upstream | Language | Role |
|---|---|---|---|
| [PowerShell](https://github.com/aphrody-labs/PowerShell) | PowerShell/PowerShell | C# | shell and automation runtime |
| [intelligent-terminal](https://github.com/aphrody-labs/intelligent-terminal) | microsoft/intelligent-terminal | C++ | Windows Terminal with ACP agent panes |
| [windows-rs](https://github.com/aphrody-labs/windows-rs) | microsoft/windows-rs | Rust | Win32, COM, WinRT projection |
| [node-api-dotnet](https://github.com/aphrody-labs/node-api-dotnet) | microsoft/node-api-dotnet | C# | Node-API bridge between JS runtimes and .NET |
| [dotnet](https://github.com/aphrody-labs/dotnet) | dotnet/dotnet | C# | .NET VMR, built from source |
| [IronRDP](https://github.com/aphrody-labs/IronRDP) | Devolutions/IronRDP | Rust | RDP client, server and protocol |
| [agent-desktop](https://github.com/aphrody-labs/agent-desktop) | vercel-labs/agent-desktop | TypeScript | computer-use CLI for agents |

```sh
git clone --recurse-submodules --shallow-submodules https://github.com/aphrody-labs/fw-nt.git
just sync    # fast-forward forks from upstream and bump gitlinks
just check   # drift report
```
