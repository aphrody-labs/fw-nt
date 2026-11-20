# fw-nt recipes

# Fast-forward every fork from upstream and bump the gitlinks
sync:
    bun tools/sync.ts

# Report forks or gitlinks behind upstream (exit 1 on drift)
check:
    bun tools/sync.ts --check

# Check out the submodules shallow
init:
    git submodule update --init --depth 1
