# Changelog

## [1.0.0-beta.8]

### Added
- SSH host key verification with trust-on-first-use policy and MITM detection
- Secure credential vault — passwords, passphrases, and API keys are now stored in a single encrypted OS keychain entry
- Host key mismatch warning dialog with trust/dismiss options
- Multiple SSH config path support in app settings
- Live system monitoring with real-time CPU, memory, and load average metrics
- "What's New" dialog shown after updates

### Changed
- Credentials are automatically migrated from legacy storage to the secure vault on first launch
- Improved SSH connection reliability with better error handling

### Fixed
- Credential migration no longer deletes old entries until the new store is confirmed
- Host key checker now handles multiple key types per host correctly
- AI API key removal now properly clears cached keys

## [1.0.0-beta.7]

### Added
- AI-powered shell command suggestions
- Agent assistant with multi-step command execution
- File browser with upload and download support
- Command templates with variables and favorites

### Changed
- Redesigned terminal workspace with dockable panels

## [1.0.0-beta.6]

### Added
- Port forwarding management
- Container log viewer with real-time streaming
- Network and volume management

### Fixed
- Build configuration for updater artifacts
