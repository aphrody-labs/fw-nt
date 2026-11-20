# fw-nt recipes

# Toolchains against toolchain.toml
doctor:
    bun tools/toolchain.ts

# Forks exist, submodules present, forks fast-forwarded, gitlinks bumped
sync:
    bun tools/sync.ts --ensure

# Report forks or gitlinks behind upstream (exit 1 on drift)
check:
    bun tools/sync.ts --check

# Upstream activity: issues, PRs, discussions, releases, recent Microsoft repos
watch:
    bun tools/watch.ts

# Check out the submodules shallow
init:
    git submodule update --init --depth 1

test:
    bun test tools/
