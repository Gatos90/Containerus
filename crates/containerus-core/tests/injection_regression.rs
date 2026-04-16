//! Regression tests for CON-41: shell command injection in the runtime
//! command builder and SSH ProxyCommand token expansion.
//!
//! These tests feed adversarial payloads through every user-controlled
//! interpolation site in `CommandBuilder::*` and assert that the resulting
//! command string contains no unescaped shell metacharacter outside a
//! position where it is already safely quoted.

use containerus_core::models::container::{ContainerAction, ContainerRuntime};
use containerus_core::runtime::CommandBuilder;
use containerus_core::ssh::config::expand_proxy_command_tokens;

/// A collection of payloads that, pre-fix, would execute arbitrary shell
/// commands. Every generated command string must contain none of these
/// exact sequences as *executed* shell fragments.
const PAYLOADS: &[&str] = &[
    "abc; echo pwned",
    "abc && echo pwned",
    "abc || echo pwned",
    "abc | echo pwned",
    "abc > /tmp/pwned",
    "$(echo pwned)",
    "`echo pwned`",
    "abc\nrm -rf /",
    "abc\0nul",
    "abc';echo pwned;#",
    "abc\"; echo pwned; \"",
];

/// Classify every character position in `cmd` as either inside a
/// single-quoted region, a double-quoted region, or normal shell context.
/// Returns a vector the same length as `cmd.chars().count()` with one
/// state per character. The POSIX `'\''` idiom closes the single-quoted
/// region, inserts a backslash-escaped quote (which we treat as "normal"
/// context because there is no ambiguity for our purposes — it is a
/// single literal character), and reopens the quoted region.
fn classify_positions(cmd: &str) -> Vec<Context> {
    #[derive(Copy, Clone)]
    enum State {
        Normal,
        InSingle,
        InDouble,
    }
    let chars: Vec<char> = cmd.chars().collect();
    let mut out = Vec::with_capacity(chars.len());
    let mut state = State::Normal;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match state {
            State::Normal => {
                if c == '\\' && i + 1 < chars.len() {
                    out.push(Context::Normal);
                    out.push(Context::Normal);
                    i += 2;
                    continue;
                }
                if c == '\'' {
                    out.push(Context::Normal); // the opening quote itself
                    state = State::InSingle;
                } else if c == '"' {
                    out.push(Context::Normal);
                    state = State::InDouble;
                } else {
                    out.push(Context::Normal);
                }
            }
            State::InSingle => {
                if c == '\'' {
                    out.push(Context::Normal);
                    state = State::Normal;
                } else {
                    out.push(Context::SingleQuoted);
                }
            }
            State::InDouble => {
                if c == '\\' && i + 1 < chars.len() {
                    out.push(Context::DoubleQuoted);
                    out.push(Context::DoubleQuoted);
                    i += 2;
                    continue;
                }
                if c == '"' {
                    out.push(Context::Normal);
                    state = State::Normal;
                } else {
                    out.push(Context::DoubleQuoted);
                }
            }
        }
        i += 1;
    }
    out
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Context {
    Normal,
    SingleQuoted,
    DoubleQuoted,
}

/// Assert that every dangerous payload fragment appears only inside a
/// single-quoted region of the generated command — i.e. the outer shell
/// cannot evaluate it. We look specifically for `echo pwned`, which is
/// what the ticket's acceptance check cares about, plus a few other
/// tell-tale metacharacter clusters from the payload list. Static
/// builder scaffolding (`if [ ... ]`, `2>/dev/null`, `||`, `&&`) is
/// untouched because it is builder-owned, not user-controlled.
fn assert_no_unescaped_injection(cmd: &str) {
    let ctx = classify_positions(cmd);
    let chars: Vec<char> = cmd.chars().collect();
    let dangerous_fragments = [
        "echo pwned",
        "rm -rf /",
        "nc evil",
        "touch pwned",
    ];
    for frag in dangerous_fragments {
        let frag_chars: Vec<char> = frag.chars().collect();
        if frag_chars.len() > chars.len() {
            continue;
        }
        for start in 0..=chars.len() - frag_chars.len() {
            if chars[start..start + frag_chars.len()] == frag_chars[..] {
                // Must be entirely inside a single-quoted region.
                let all_quoted = ctx[start..start + frag_chars.len()]
                    .iter()
                    .all(|c| *c == Context::SingleQuoted);
                assert!(
                    all_quoted,
                    "dangerous fragment {:?} appears outside single quotes in:\n  {}",
                    frag, cmd
                );
            }
        }
    }
}

#[test]
fn inspect_container_is_safe_against_injection() {
    for p in PAYLOADS {
        let cmd = CommandBuilder::inspect_container(ContainerRuntime::Docker, p);
        assert_no_unescaped_injection(&cmd);
    }
}

#[test]
fn batch_inspect_containers_is_safe_against_injection() {
    let refs: Vec<&str> = PAYLOADS.iter().copied().collect();
    let cmd = CommandBuilder::batch_inspect_containers(ContainerRuntime::Docker, &refs);
    assert_no_unescaped_injection(&cmd);
}

#[test]
fn container_action_is_safe_against_injection() {
    let actions = [
        ContainerAction::Start,
        ContainerAction::Stop,
        ContainerAction::Restart,
        ContainerAction::Pause,
        ContainerAction::Unpause,
        ContainerAction::Remove,
    ];
    for action in actions {
        for p in PAYLOADS {
            for rt in [
                ContainerRuntime::Docker,
                ContainerRuntime::Podman,
                ContainerRuntime::Apple,
            ] {
                let cmd = CommandBuilder::container_action(rt, action, p);
                assert_no_unescaped_injection(&cmd);
            }
        }
    }
}

#[test]
fn force_remove_container_is_safe_against_injection() {
    for p in PAYLOADS {
        let cmd = CommandBuilder::force_remove_container(ContainerRuntime::Docker, p);
        assert_no_unescaped_injection(&cmd);
    }
}

#[test]
fn container_logs_is_safe_against_injection() {
    for p in PAYLOADS {
        let cmd = CommandBuilder::container_logs(ContainerRuntime::Docker, p, Some(10), true);
        assert_no_unescaped_injection(&cmd);
        let cmd = CommandBuilder::container_logs_stream(ContainerRuntime::Docker, p);
        assert_no_unescaped_injection(&cmd);
    }
}

#[test]
fn pull_and_remove_image_are_safe_against_injection() {
    for p in PAYLOADS {
        assert_no_unescaped_injection(&CommandBuilder::pull_image(ContainerRuntime::Docker, p));
        assert_no_unescaped_injection(&CommandBuilder::remove_image(
            ContainerRuntime::Docker,
            p,
            true,
        ));
        assert_no_unescaped_injection(&CommandBuilder::inspect_image(
            ContainerRuntime::Docker,
            p,
        ));
        assert_no_unescaped_injection(&CommandBuilder::tag_image(
            ContainerRuntime::Docker,
            p,
            p,
        ));
    }
}

#[test]
fn build_image_is_safe_against_injection() {
    let args: Vec<(String, String)> = PAYLOADS
        .iter()
        .map(|p| (format!("KEY_{}", p), format!("VAL_{}", p)))
        .collect();
    for p in PAYLOADS {
        let cmd = CommandBuilder::build_image(
            ContainerRuntime::Docker,
            p,
            Some(p),
            p,
            p,
            &args,
            true,
        );
        assert_no_unescaped_injection(&cmd);
    }
}

#[test]
fn volume_commands_are_safe_against_injection() {
    for p in PAYLOADS {
        assert_no_unescaped_injection(&CommandBuilder::create_volume(ContainerRuntime::Docker, p));
        assert_no_unescaped_injection(&CommandBuilder::remove_volume(
            ContainerRuntime::Docker,
            p,
            false,
        ));
        assert_no_unescaped_injection(&CommandBuilder::inspect_volume(
            ContainerRuntime::Docker,
            p,
        ));
    }
}

#[test]
fn network_commands_are_safe_against_injection() {
    for p in PAYLOADS {
        assert_no_unescaped_injection(&CommandBuilder::create_network(
            ContainerRuntime::Docker,
            p,
            Some(p),
            Some(p),
        ));
        assert_no_unescaped_injection(&CommandBuilder::remove_network(
            ContainerRuntime::Docker,
            p,
        ));
        assert_no_unescaped_injection(&CommandBuilder::inspect_network(
            ContainerRuntime::Docker,
            p,
        ));
        assert_no_unescaped_injection(&CommandBuilder::connect_to_network(
            ContainerRuntime::Docker,
            p,
            p,
        ));
        assert_no_unescaped_injection(&CommandBuilder::disconnect_from_network(
            ContainerRuntime::Docker,
            p,
            p,
        ));
    }
}

#[test]
fn exec_commands_are_safe_against_injection() {
    for p in PAYLOADS {
        assert_no_unescaped_injection(&CommandBuilder::exec_terminal(
            ContainerRuntime::Docker,
            p,
            p,
        ));
        assert_no_unescaped_injection(&CommandBuilder::exec_command(
            ContainerRuntime::Docker,
            p,
            p,
        ));
    }
}

#[test]
fn file_browser_commands_are_safe_against_injection() {
    for p in PAYLOADS {
        assert_no_unescaped_injection(&CommandBuilder::list_directory(p));
        assert_no_unescaped_injection(&CommandBuilder::read_file(p, 1024));
        assert_no_unescaped_injection(&CommandBuilder::write_file_from_base64(p, p));
        assert_no_unescaped_injection(&CommandBuilder::create_directory(p));
        assert_no_unescaped_injection(&CommandBuilder::delete_file(p));
        assert_no_unescaped_injection(&CommandBuilder::delete_directory(p));
        assert_no_unescaped_injection(&CommandBuilder::rename_path(p, p));
        assert_no_unescaped_injection(&CommandBuilder::read_file_base64(p));
        assert_no_unescaped_injection(&CommandBuilder::write_file_base64(p, p));
    }
}

#[test]
fn proxy_command_expansion_is_safe_against_injection() {
    for p in PAYLOADS {
        let cmd = expand_proxy_command_tokens("nc %h %p", p, 22, "admin");
        assert_no_unescaped_injection(&cmd);
        let cmd = expand_proxy_command_tokens("ssh -l %r %h", "host", 22, p);
        assert_no_unescaped_injection(&cmd);
    }
}

/// Ticket's acceptance check — `container_id = "abc; echo pwned"` must NOT
/// cause `echo pwned` to execute. Asserting on the generated command string
/// is a proxy for this because the string is what gets handed to
/// `/bin/sh -c` or `channel.exec` downstream.
#[test]
fn acceptance_echo_pwned_payload_is_quoted_not_executed() {
    let cmd = CommandBuilder::container_action(
        ContainerRuntime::Docker,
        ContainerAction::Start,
        "abc; echo pwned",
    );
    // The literal string "echo pwned" appears only inside a single-quoted
    // region, so the outer shell will never evaluate it.
    assert_eq!(cmd, "docker start 'abc; echo pwned'");
}
