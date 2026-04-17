//! Containerus server binary. All wiring lives in the library crate; this
//! file is a thin entry point so the library can also be consumed by the
//! integration-test harness under `tests/`.

#[tokio::main]
async fn main() {
    containerus_server::run().await;
}
