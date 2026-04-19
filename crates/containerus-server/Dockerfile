# Multi-stage build for Containerus Server
FROM rust:1.90-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests for every member referenced by the root Cargo.toml.
# The workspace declares src-tauri, containerus-core, containerus-rbac-macros,
# and containerus-server — cargo refuses to load the workspace if any manifest
# is missing.
COPY Cargo.toml Cargo.lock ./
COPY crates/containerus-core/Cargo.toml crates/containerus-core/Cargo.toml
COPY crates/containerus-rbac-macros/Cargo.toml crates/containerus-rbac-macros/Cargo.toml
COPY crates/containerus-server/Cargo.toml crates/containerus-server/Cargo.toml

# Replace src-tauri with a stub crate so the desktop app's Tauri/system
# dependencies do not need to resolve in the server image. The stub keeps the
# workspace member valid; the server build only consumes containerus-core and
# containerus-rbac-macros.
RUN mkdir -p src-tauri/src \
 && echo "pub fn lib() {}" > src-tauri/src/lib.rs \
 && printf '[package]\nname = "containerus"\nversion = "0.1.0"\nedition = "2021"\n[lib]\nname = "containerus_lib"\npath = "src/lib.rs"\n' > src-tauri/Cargo.toml

# Copy the real source for every crate the server actually depends on.
# We rely on the BuildKit / GHA layer cache (configured in the workflow) to
# avoid recompiling cargo deps on every push; the dummy-src "deps cache trick"
# silently produced a stale build because cargo did not detect the real source
# as newer than the cached dummy artifacts.
COPY crates/containerus-core crates/containerus-core
COPY crates/containerus-rbac-macros crates/containerus-rbac-macros
COPY crates/containerus-server/src crates/containerus-server/src
COPY crates/containerus-server/migrations crates/containerus-server/migrations

RUN cargo build --release -p containerus-server

# Runtime image — must match the builder's Debian release so glibc versions
# line up. rust:1.90-slim is based on debian:trixie-slim (glibc 2.39); using
# bookworm-slim here (glibc 2.36) caused the binary to fail at startup with
# "GLIBC_2.38 not found".
FROM debian:trixie-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/* \
    && groupadd --system containerus && useradd --system --gid containerus --no-create-home containerus

COPY --from=builder /app/target/release/containerus-server /usr/local/bin/containerus-server

USER containerus

EXPOSE 8080

CMD ["containerus-server"]
