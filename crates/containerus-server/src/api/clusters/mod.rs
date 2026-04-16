mod apply;
pub(crate) mod common;
mod crud;
mod discovery;
mod files;
mod logs;
mod nodes;
mod resources;
mod topology;
mod workloads;

use axum::Router;
use crate::AppState;

/// Routes for single-cluster operations: get, delete, test, resources, deployments, apply, logs, nodes, topology, pod files.
pub fn router() -> Router<AppState> {
    Router::new()
        .merge(crud::single_cluster_router())
        .merge(resources::router())
        .merge(workloads::router())
        .merge(apply::router())
        .merge(logs::router())
        .merge(nodes::router())
        .merge(topology::router())
        .merge(files::router())
        .merge(discovery::router())
}

/// Routes for listing/creating clusters within an environment.
pub fn environment_router() -> Router<AppState> {
    crud::environment_router()
}
