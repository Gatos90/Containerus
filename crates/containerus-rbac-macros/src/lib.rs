//! Proc-macro attributes that make RBAC gating on API handlers declarative.
//!
//! See CON-83. Two attributes are exported:
//!
//! - `#[require_permissions("a", "b", ...)]` — attach to an async handler fn.
//!   Takes one or more permission strings; the handler still calls
//!   `user.require*()` at runtime, but the attribute both (a) serves as the
//!   machine-readable declaration of "this handler needs these permissions"
//!   and (b) lets the compile-time coverage check (see the
//!   `rbac_macro_coverage` test in containerus-server) prove every handler is
//!   gated.
//!
//! - `#[public_endpoint]` — the explicit opt-out for routes that are public by
//!   design (health, login, register, refresh, logout).
//!
//! Both attributes are intentionally thin: they validate the input and inject
//! a hidden `const` inside the function body so the attribute survives
//! through the coverage scan even if the source is rewritten by rustfmt.

use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::quote;
use syn::parse::{Parse, ParseStream};
use syn::punctuated::Punctuated;
use syn::{parse_macro_input, Ident, ItemFn, LitStr, Stmt, Token};

struct PermissionList {
    perms: Punctuated<LitStr, Token![,]>,
}

impl Parse for PermissionList {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let perms = Punctuated::<LitStr, Token![,]>::parse_terminated(input)?;
        if perms.is_empty() {
            return Err(syn::Error::new(
                input.span(),
                "#[require_permissions(...)] must name at least one permission string",
            ));
        }
        Ok(PermissionList { perms })
    }
}

/// Mark an API handler with the set of permissions it enforces at runtime.
///
/// ```ignore
/// #[require_permissions("containers.view", "containers.exec")]
/// async fn list_containers(user: SystemScoped, ...) { ... }
/// ```
#[proc_macro_attribute]
pub fn require_permissions(attr: TokenStream, item: TokenStream) -> TokenStream {
    let perms = parse_macro_input!(attr as PermissionList);
    let mut func = parse_macro_input!(item as ItemFn);

    let values: Vec<&LitStr> = perms.perms.iter().collect();

    // Inject a hidden marker at the top of the body so the attribute's effect
    // is observable from the expanded source (helpful for tests that use
    // cargo-expand) without changing runtime behaviour.
    let marker: Stmt = syn::parse_quote! {
        const _RBAC_REQUIRED_PERMISSIONS: &[&::core::primitive::str] = &[#(#values),*];
    };
    func.block.stmts.insert(0, marker);

    quote!(#func).into()
}

/// Mark an API handler as an explicit public endpoint (no permission gate).
///
/// Use sparingly — this is for health checks, login, register, and other
/// pre-auth routes. Every `#[public_endpoint]` is visible to the coverage
/// scanner so reviewers can grep for them.
#[proc_macro_attribute]
pub fn public_endpoint(attr: TokenStream, item: TokenStream) -> TokenStream {
    if !attr.is_empty() {
        let span = Span::call_site();
        return syn::Error::new(span, "#[public_endpoint] does not take arguments")
            .to_compile_error()
            .into();
    }
    let mut func = parse_macro_input!(item as ItemFn);
    let ident = Ident::new("_RBAC_PUBLIC_ENDPOINT", Span::call_site());
    let marker: Stmt = syn::parse_quote! {
        const #ident: () = ();
    };
    func.block.stmts.insert(0, marker);
    quote!(#func).into()
}
