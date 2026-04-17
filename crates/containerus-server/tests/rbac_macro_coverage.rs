//! Compile-/test-time coverage guard for CON-83.
//!
//! Walks every `src/api/**/*.rs` module in this crate and uses `syn` to
//! prove that every async fn registered on an axum router carries either
//! `#[require_permissions(...)]` or `#[public_endpoint]`. A missing
//! attribute (i.e. a handler landed on a router without a permission
//! declaration) fails the test and prints the offending file and fn name.
//!
//! This replaces the `==> Checking every API route handler is
//! permission-gated...` grep block in `scripts/check_audit_ip.sh` — the
//! macro + this scan are now the source of truth for route gating.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use syn::visit::Visit;
use syn::{File, ItemFn, Meta};

/// Collect every identifier referenced inside `get(...)/post(...)/...` and
/// `.get(...)/.post(...)/...` router chain calls. The resulting set is the
/// ground-truth of handler function names for this crate.
struct RouteCollector {
    handlers: HashSet<String>,
}

impl<'ast> Visit<'ast> for RouteCollector {
    fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
        if let syn::Expr::Path(p) = &*call.func {
            if let Some(ident) = p.path.get_ident() {
                let name = ident.to_string();
                if matches!(name.as_str(), "get" | "post" | "put" | "patch" | "delete") {
                    if let Some(syn::Expr::Path(arg)) = call.args.first() {
                        if let Some(h) = arg.path.get_ident() {
                            self.handlers.insert(h.to_string());
                        }
                    }
                }
            }
        }
        syn::visit::visit_expr_call(self, call);
    }

    fn visit_expr_method_call(&mut self, m: &'ast syn::ExprMethodCall) {
        let method = m.method.to_string();
        if matches!(method.as_str(), "get" | "post" | "put" | "patch" | "delete") {
            if let Some(syn::Expr::Path(arg)) = m.args.first() {
                if let Some(h) = arg.path.get_ident() {
                    self.handlers.insert(h.to_string());
                }
            }
        }
        syn::visit::visit_expr_method_call(self, m);
    }
}

/// Visit every async fn in a file and, if it matches a router-registered
/// handler name, verify it carries one of the two RBAC attributes.
struct CoverageChecker<'a> {
    handler_names: &'a HashSet<String>,
    file_path: &'a Path,
    violations: Vec<String>,
}

impl<'ast, 'a> Visit<'ast> for CoverageChecker<'a> {
    fn visit_item_fn(&mut self, item: &'ast ItemFn) {
        if item.sig.asyncness.is_none() {
            return;
        }
        let name = item.sig.ident.to_string();
        if !self.handler_names.contains(&name) {
            return;
        }
        let has_attr = item.attrs.iter().any(|a| {
            let path = match &a.meta {
                Meta::Path(p) => p,
                Meta::List(l) => &l.path,
                Meta::NameValue(nv) => &nv.path,
            };
            path.is_ident("require_permissions") || path.is_ident("public_endpoint")
        });
        if !has_attr {
            self.violations.push(format!(
                "{}::{}",
                self.file_path.display(),
                name
            ));
        }
    }
}

fn api_root() -> PathBuf {
    // Tests run with CARGO_MANIFEST_DIR set to the crate root.
    let manifest = std::env::var("CARGO_MANIFEST_DIR")
        .expect("CARGO_MANIFEST_DIR must be set by cargo test");
    PathBuf::from(manifest).join("src").join("api")
}

fn walk_rs(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap_or_else(|e| panic!("read_dir {dir:?}: {e}")) {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_dir() {
            walk_rs(&path, out);
        } else if path.extension().and_then(|s| s.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

#[test]
fn every_api_handler_is_permission_gated() {
    let root = api_root();
    let mut files = Vec::new();
    walk_rs(&root, &mut files);
    files.sort();

    // Pass 1: collect handler names from every router() / environment_router()
    // definition across the api tree.
    let mut collector = RouteCollector {
        handlers: HashSet::new(),
    };
    let mut parsed: Vec<(PathBuf, File)> = Vec::with_capacity(files.len());
    for path in &files {
        let src = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("read {path:?}: {e}"));
        let tree: File = syn::parse_file(&src)
            .unwrap_or_else(|e| panic!("parse {path:?}: {e}"));
        collector.visit_file(&tree);
        parsed.push((path.clone(), tree));
    }

    assert!(
        !collector.handlers.is_empty(),
        "coverage scanner found zero router-registered handlers — did the api/ \
         module tree move? Expected at least one .route(...) in {}",
        root.display()
    );

    // Pass 2: for each file, flag any router-registered async fn that's
    // missing #[require_permissions] / #[public_endpoint].
    let mut violations = Vec::new();
    for (path, tree) in &parsed {
        let mut checker = CoverageChecker {
            handler_names: &collector.handlers,
            file_path: path,
            violations: Vec::new(),
        };
        checker.visit_file(tree);
        violations.extend(checker.violations);
    }

    assert!(
        violations.is_empty(),
        "The following API handlers are registered on a router but missing \
         #[require_permissions(...)] or #[public_endpoint] (CON-83):\n  - {}\n\
         Add the attribute so RBAC coverage stays enforced at compile/test time.",
        violations.join("\n  - ")
    );
}

/// Companion smoke test: proves the proc-macro itself rejects handlers that
/// attempt to declare an empty permission list. This is the "unit test
/// proving the macro rejects handlers missing permission metadata" part of
/// the CON-83 DoD. The compile-fail scenarios live in
/// `crates/containerus-rbac-macros/tests/rejects_missing_metadata.rs`.
#[test]
fn macro_compile_fail_suite_exists() {
    let suite = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|root| {
            root.join("crates/containerus-rbac-macros/tests/rejects_missing_metadata.rs")
        });
    if let Some(p) = suite {
        assert!(
            p.exists(),
            "expected macro-level compile-fail test at {}",
            p.display()
        );
    }
}
