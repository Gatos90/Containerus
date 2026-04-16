use std::collections::HashSet;

use rusqlite::{Connection, Result as SqliteResult};

use crate::models::container::ContainerRuntime;
use crate::models::system::{ConnectionType, ContainerSystem, SystemId};

pub fn insert_system(conn: &Connection, system: &ContainerSystem) -> SqliteResult<()> {
    let runtimes_json = serde_json::to_string(&system.available_runtimes).unwrap_or_default();
    let ssh_config_json = system
        .ssh_config
        .as_ref()
        .map(|c| serde_json::to_string(c).unwrap_or_default());

    conn.execute(
        "INSERT INTO systems (id, name, hostname, connection_type, primary_runtime, available_runtimes, ssh_config, auto_connect)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        (
            &system.id.0,
            &system.name,
            &system.hostname,
            connection_type_to_str(system.connection_type),
            runtime_to_str(system.primary_runtime),
            &runtimes_json,
            &ssh_config_json,
            system.auto_connect as i32,
        ),
    )?;

    Ok(())
}

pub fn get_all_systems(conn: &Connection) -> SqliteResult<Vec<ContainerSystem>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, hostname, connection_type, primary_runtime, available_runtimes, ssh_config, auto_connect FROM systems",
    )?;

    let systems = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let hostname: String = row.get(2)?;
            let connection_type_str: String = row.get(3)?;
            let primary_runtime_str: String = row.get(4)?;
            let runtimes_json: String = row.get(5)?;
            let ssh_config_json: Option<String> = row.get(6)?;
            let auto_connect: i32 = row.get(7)?;

            Ok(ContainerSystem {
                id: SystemId(id),
                name,
                hostname,
                connection_type: str_to_connection_type(&connection_type_str),
                primary_runtime: str_to_runtime(&primary_runtime_str),
                available_runtimes: serde_json::from_str(&runtimes_json).unwrap_or_default(),
                ssh_config: ssh_config_json.and_then(|j| serde_json::from_str(&j).ok()),
                auto_connect: auto_connect != 0,
            })
        })?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(systems)
}

pub fn update_system_runtimes(
    conn: &Connection,
    system_id: &str,
    runtimes: &HashSet<ContainerRuntime>,
) -> SqliteResult<()> {
    let runtimes_json = serde_json::to_string(runtimes).unwrap_or_default();

    conn.execute(
        "UPDATE systems SET available_runtimes = ?1 WHERE id = ?2",
        (&runtimes_json, system_id),
    )?;

    Ok(())
}

pub fn update_primary_runtime(
    conn: &Connection,
    system_id: &str,
    runtime: ContainerRuntime,
) -> SqliteResult<()> {
    conn.execute(
        "UPDATE systems SET primary_runtime = ?1 WHERE id = ?2",
        (runtime_to_str(runtime), system_id),
    )?;

    Ok(())
}

pub fn update_system(conn: &Connection, system: &ContainerSystem) -> SqliteResult<bool> {
    let runtimes_json = serde_json::to_string(&system.available_runtimes).unwrap_or_default();
    let ssh_config_json = system
        .ssh_config
        .as_ref()
        .map(|c| serde_json::to_string(c).unwrap_or_default());

    let rows_affected = conn.execute(
        "UPDATE systems SET name = ?1, hostname = ?2, connection_type = ?3, primary_runtime = ?4, available_runtimes = ?5, ssh_config = ?6, auto_connect = ?7 WHERE id = ?8",
        (
            &system.name,
            &system.hostname,
            connection_type_to_str(system.connection_type),
            runtime_to_str(system.primary_runtime),
            &runtimes_json,
            &ssh_config_json,
            system.auto_connect as i32,
            &system.id.0,
        ),
    )?;

    Ok(rows_affected > 0)
}

pub fn delete_system(conn: &Connection, system_id: &str) -> SqliteResult<bool> {
    let rows_affected = conn.execute("DELETE FROM systems WHERE id = ?1", [system_id])?;
    Ok(rows_affected > 0)
}

pub(super) fn connection_type_to_str(ct: ConnectionType) -> &'static str {
    match ct {
        ConnectionType::Local => "local",
        ConnectionType::Remote => "remote",
    }
}

pub(super) fn str_to_connection_type(s: &str) -> ConnectionType {
    match s {
        "remote" => ConnectionType::Remote,
        _ => ConnectionType::Local,
    }
}

pub(super) fn runtime_to_str(rt: ContainerRuntime) -> &'static str {
    match rt {
        ContainerRuntime::Docker => "docker",
        ContainerRuntime::Podman => "podman",
        ContainerRuntime::Apple => "apple",
    }
}

pub(super) fn str_to_runtime(s: &str) -> ContainerRuntime {
    match s {
        "podman" => ContainerRuntime::Podman,
        "apple" => ContainerRuntime::Apple,
        _ => ContainerRuntime::Docker,
    }
}
