# Multi-stage build for Containerus Server
FROM rust:1.83-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests for every member referenced by the root Cargo.toml.
# The workspace declares src-tauri, containerus-core, containerus-rbac-macros,
# and containerus-server — cargo refuses to load the workspace if any manifest
# is missing, so all four must be present before we can prime the dep cache.
COPY Cargo.toml Cargo.lock ./
COPY crates/containerus-core/Cargo.toml crates/containerus-core/Cargo.toml
COPY crates/containerus-rbac-macros/Cargo.toml crates/containerus-rbac-macros/Cargo.toml
COPY crates/containerus-server/Cargo.toml crates/containerus-server/Cargo.toml

# Create dummy src files to cache dependencies
RUN mkdir -p crates/containerus-core/src && echo "pub fn lib() {}" > crates/containerus-core/src/lib.rs
RUN mkdir -p crates/containerus-rbac-macros/src && echo "" > crates/containerus-rbac-macros/src/lib.rs
RUN mkdir -p crates/containerus-server/src && echo "fn main() {}" > crates/containerus-server/src/main.rs
RUN mkdir -p src-tauri/src && echo "pub fn lib() {}" > src-tauri/src/lib.rs

# Create a minimal Cargo.toml for src-tauri that skips tauri deps
RUN printf '[package]\nname = "containerus"\nversion = "0.1.0"\nedition = "2021"\n[lib]\nname = "containerus_lib"\npath = "src/lib.rs"' > src-tauri/Cargo.toml

# Build dependencies (cached layer)
RUN cargo build --release -p containerus-server 2>/dev/null || true

# Copy actual source code
COPY crates/containerus-core/src crates/containerus-core/src
COPY crates/containerus-rbac-macros/src crates/containerus-rbac-macros/src
COPY crates/containerus-server/src crates/containerus-server/src
COPY crates/containerus-server/migrations crates/containerus-server/migrations

# Build the server
RUN cargo build --release -p containerus-server

# Runtime image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/* \
    && groupadd --system containerus && useradd --system --gid containerus --no-create-home containerus

COPY --from=builder /app/target/release/containerus-server /usr/local/bin/containerus-server

USER containerus

EXPOSE 8080

CMD ["containerus-server"]
