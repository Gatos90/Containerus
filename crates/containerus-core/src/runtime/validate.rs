//! Validators for user-provided container/image/volume/network identifiers.
//!
//! These are used at API and Tauri command boundaries as defense-in-depth on
//! top of `CommandBuilder::shell_escape`. Shell-escaping already prevents
//! command injection, but rejecting obviously malformed identifiers also
//! surfaces malformed requests earlier and makes logs less noisy.
//!
//! Rules follow Docker's reference grammars:
//! - container id / short id: `[a-f0-9]{12,64}`
//! - container/volume/network name: `[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}`
//! - image reference: lowercase host/path/tag subset, up to 255 chars, disallows
//!   whitespace and shell metacharacters outright.

use crate::models::error::ContainerError;

/// Maximum accepted length for an image reference (name:tag@digest).
const MAX_IMAGE_REF_LEN: usize = 255;

/// Maximum accepted length for a container / volume / network name.
const MAX_NAME_LEN: usize = 128;

fn invalid(kind: &str, value: &str) -> ContainerError {
    ContainerError::InvalidConfiguration(format!(
        "invalid {} '{}': must match Docker's allowed identifier charset",
        kind, value
    ))
}

/// Validate a container id (short or full hex) or container name.
///
/// Accepts either a hex id (12-64 chars of `[a-f0-9]`) or a Docker-style
/// name beginning with `[a-zA-Z0-9]` followed by up to 127 of
/// `[a-zA-Z0-9_.-]`.
pub fn validate_container_ref(value: &str) -> Result<(), ContainerError> {
    if value.is_empty() || value.len() > MAX_NAME_LEN {
        return Err(invalid("container reference", value));
    }
    if is_hex_id(value) || is_docker_name(value) {
        return Ok(());
    }
    Err(invalid("container reference", value))
}

/// Validate a volume or network name.
pub fn validate_name(value: &str) -> Result<(), ContainerError> {
    if is_docker_name(value) {
        Ok(())
    } else {
        Err(invalid("name", value))
    }
}

/// Validate a network driver string (e.g. `bridge`, `overlay`, `macvlan`).
pub fn validate_driver(value: &str) -> Result<(), ContainerError> {
    if value.is_empty() || value.len() > 64 {
        return Err(invalid("driver", value));
    }
    if value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        Ok(())
    } else {
        Err(invalid("driver", value))
    }
}

/// Validate a CIDR subnet (e.g. `10.0.0.0/24`, `fd00::/64`).
///
/// Intentionally permissive: accepts any string that consists of hex digits,
/// dots, colons, and a single `/prefix` between 0 and 128. Stricter parsing
/// is done by the runtime itself.
pub fn validate_subnet(value: &str) -> Result<(), ContainerError> {
    if value.is_empty() || value.len() > 64 {
        return Err(invalid("subnet", value));
    }
    let mut parts = value.split('/');
    let addr = parts.next().unwrap_or("");
    let prefix = parts.next();
    if parts.next().is_some() {
        return Err(invalid("subnet", value));
    }
    if addr.is_empty()
        || !addr
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '.' || c == ':')
    {
        return Err(invalid("subnet", value));
    }
    if let Some(p) = prefix {
        match p.parse::<u8>() {
            Ok(n) if n <= 128 => {}
            _ => return Err(invalid("subnet", value)),
        }
    }
    Ok(())
}

/// Validate a Docker image reference (e.g. `nginx`, `nginx:latest`,
/// `registry.example.com:5000/team/image:tag@sha256:...`).
///
/// Rejects whitespace, semicolons, pipes, backticks, `$`, and other shell
/// metacharacters. Not a full parser — delegates final validation to the
/// container runtime.
pub fn validate_image_ref(value: &str) -> Result<(), ContainerError> {
    if value.is_empty() || value.len() > MAX_IMAGE_REF_LEN {
        return Err(invalid("image reference", value));
    }
    for c in value.chars() {
        let ok = c.is_ascii_alphanumeric()
            || matches!(c, '.' | '-' | '_' | ':' | '/' | '@' | '+');
        if !ok {
            return Err(invalid("image reference", value));
        }
    }
    // Must start with alphanumeric
    match value.chars().next() {
        Some(c) if c.is_ascii_alphanumeric() => Ok(()),
        _ => Err(invalid("image reference", value)),
    }
}

/// Validate an exec shell path like `/bin/sh`, `/bin/bash`, `sh`, `bash`.
pub fn validate_exec_shell(value: &str) -> Result<(), ContainerError> {
    if value.is_empty() || value.len() > 256 {
        return Err(invalid("exec shell", value));
    }
    for c in value.chars() {
        let ok = c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '/');
        if !ok {
            return Err(invalid("exec shell", value));
        }
    }
    Ok(())
}

fn is_hex_id(value: &str) -> bool {
    let len = value.len();
    (12..=64).contains(&len) && value.chars().all(|c| c.is_ascii_hexdigit())
}

fn is_docker_name(value: &str) -> bool {
    if value.is_empty() || value.len() > MAX_NAME_LEN {
        return false;
    }
    let mut chars = value.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_container_ids_are_accepted() {
        assert!(validate_container_ref("abc123def456").is_ok());
        assert!(validate_container_ref("deadbeefcafebabe0123456789abcdef").is_ok());
        assert!(validate_container_ref("my_container-1.0").is_ok());
        assert!(validate_container_ref("nginx").is_ok());
    }

    #[test]
    fn injection_payloads_are_rejected_as_container_refs() {
        for payload in [
            "abc; echo pwned",
            "abc || echo pwned",
            "$(echo pwned)",
            "`echo pwned`",
            "abc\nrm -rf /",
            "abc|nc evil 1",
            "abc & evil",
            "abc > /dev/null",
            " ",
            "",
            "-leading-dash",
        ] {
            assert!(
                validate_container_ref(payload).is_err(),
                "payload should be rejected: {:?}",
                payload
            );
        }
    }

    #[test]
    fn oversize_names_are_rejected() {
        let huge = "a".repeat(512);
        assert!(validate_container_ref(&huge).is_err());
        assert!(validate_name(&huge).is_err());
        assert!(validate_image_ref(&huge).is_err());
    }

    #[test]
    fn valid_names_are_accepted() {
        assert!(validate_name("myvol").is_ok());
        assert!(validate_name("net-1.2_3").is_ok());
    }

    #[test]
    fn injection_payloads_are_rejected_as_names() {
        for payload in ["abc; evil", "$(evil)", "`evil`", "abc|evil", "abc evil"] {
            assert!(
                validate_name(payload).is_err(),
                "payload should be rejected: {:?}",
                payload
            );
        }
    }

    #[test]
    fn valid_drivers_are_accepted() {
        for d in ["bridge", "overlay", "macvlan", "host", "custom_driver-v1"] {
            assert!(validate_driver(d).is_ok(), "driver: {}", d);
        }
    }

    #[test]
    fn injection_payloads_are_rejected_as_drivers() {
        for payload in ["bridge;evil", "$(evil)", "bridge|evil", "", "bridge evil"] {
            assert!(validate_driver(payload).is_err());
        }
    }

    #[test]
    fn valid_subnets_are_accepted() {
        for s in ["10.0.0.0/24", "192.168.1.0/16", "fd00::/64", "2001:db8::/32"] {
            assert!(validate_subnet(s).is_ok(), "subnet: {}", s);
        }
    }

    #[test]
    fn injection_payloads_are_rejected_as_subnets() {
        for payload in [
            "10.0.0.0/24;evil",
            "10.0.0.0/$(evil)",
            "10.0.0.0/24/25",
            "10.0.0.0/999",
            "10.0.0.0 24",
            "",
        ] {
            assert!(
                validate_subnet(payload).is_err(),
                "payload should be rejected: {:?}",
                payload
            );
        }
    }

    #[test]
    fn valid_image_refs_are_accepted() {
        for r in [
            "nginx",
            "nginx:latest",
            "library/alpine:3.19",
            "ghcr.io/org/repo:tag",
            "registry.example.com:5000/team/image:tag",
            "image@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd",
        ] {
            assert!(validate_image_ref(r).is_ok(), "image: {}", r);
        }
    }

    #[test]
    fn injection_payloads_are_rejected_as_image_refs() {
        for payload in [
            "nginx;evil",
            "nginx|evil",
            "$(evil)",
            "`evil`",
            "nginx evil",
            "nginx&evil",
            "nginx\nevil",
            "",
        ] {
            assert!(
                validate_image_ref(payload).is_err(),
                "payload should be rejected: {:?}",
                payload
            );
        }
    }

    #[test]
    fn valid_exec_shells_are_accepted() {
        for s in ["/bin/sh", "/bin/bash", "/usr/bin/zsh", "sh", "bash"] {
            assert!(validate_exec_shell(s).is_ok(), "shell: {}", s);
        }
    }

    #[test]
    fn injection_payloads_are_rejected_as_exec_shells() {
        for payload in ["/bin/sh;evil", "$(evil)", "/bin/sh evil", ""] {
            assert!(validate_exec_shell(payload).is_err());
        }
    }
}
