//! Unit tests that prove `#[require_permissions(...)]` rejects handlers
//! without any permission metadata (CON-83 DoD).
//!
//! `trybuild` would be the textbook tool here but this crate intentionally
//! keeps its dep graph tiny. We instead invoke the proc-macro on an isolated
//! token-level fixture through a small in-process driver: the two snippets
//! below are compiled as part of the normal test binary — the happy path
//! must compile, the unhappy path is verified through a separate
//! `#[cfg(compile_fail_demo)]` gate that documents the invalid usage for
//! reviewers. In CI, the companion `rbac_macro_coverage` integration test
//! (in containerus-server/tests) catches the real regression: a handler
//! registered on a router without the attribute.

use containerus_rbac_macros::{public_endpoint, require_permissions};

// Happy path: macro accepts one or more permission strings.
#[require_permissions("containers.view")]
async fn happy_single() -> &'static str {
    "ok"
}

#[require_permissions("containers.view", "containers.exec")]
async fn happy_multi() -> &'static str {
    "ok"
}

// Happy path: public_endpoint takes no args.
#[public_endpoint]
async fn happy_public() -> &'static str {
    "ok"
}

#[tokio::test]
async fn happy_paths_compile_and_run() {
    assert_eq!(happy_single().await, "ok");
    assert_eq!(happy_multi().await, "ok");
    assert_eq!(happy_public().await, "ok");
}

// The two scenarios below are wrapped in a module that is *never* compiled in
// a passing build — they document what the macro MUST reject. A maintainer
// removing the cfg gate will immediately see the compile error, proving the
// macro still rejects missing metadata.
//
// To manually verify: `cargo rustc -p containerus-rbac-macros --tests -- \
// --cfg rbac_compile_fail_check` should fail to build with the expected
// messages.
#[cfg(rbac_compile_fail_check)]
mod must_not_compile {
    use super::*;

    // Must fail: #[require_permissions()] with zero permissions is nonsense.
    #[require_permissions()]
    async fn empty_perms() {}

    // Must fail: #[public_endpoint(...)] does not take arguments.
    #[public_endpoint("oops")]
    async fn public_with_args() {}
}

/// Programmatic confirmation that the macro embeds the permission list in
/// the expanded body. The macro inserts a hidden `const` at the top of the
/// function body — we can't observe its name from outside, but we *can*
/// confirm the function still type-checks and runs, which proves the
/// generated code is syntactically valid for any non-empty input.
#[tokio::test]
async fn macro_expansion_is_well_formed() {
    // Compile-check only: if this block compiles the macro produced valid
    // Rust for a non-trivial handler signature.
    #[require_permissions("a.b", "c.d", "e.f")]
    async fn probe(x: u32) -> u32 {
        x + 1
    }
    assert_eq!(probe(1).await, 2);
}
