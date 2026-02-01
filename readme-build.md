# Containerus Build & Release System

Local build scripts for building Containerus across all platforms (macOS, Windows, Linux, Android, iOS) from your Mac and pushing binaries to GitHub releases.

## Quick Start

```bash
# 1. First-time setup
./scripts/setup-macos-ios.sh    # macOS/iOS dependencies
./scripts/setup-android-sdk.sh  # Android SDK/NDK
cp scripts/config.sh.template scripts/config.sh
# Edit config.sh with your signing credentials

# 2. Full release
./scripts/release.sh 0.2.0
```

## Scripts Overview

| Script | Purpose |
|--------|---------|
| `scripts/release.sh` | Main orchestrator - version bump, build all platforms, create GitHub release |
| `scripts/build-macos.sh` | Build macOS ARM64 + x64 DMGs with signing and notarization |
| `scripts/build-linux.sh` | Docker-based Linux build (deb, AppImage) |
| `scripts/build-windows.sh` | Docker-based Windows cross-compilation (exe, msi) |
| `scripts/build-android.sh` | Android APK build with signing |
| `scripts/build-ios.sh` | iOS IPA build with signing |
| `scripts/setup-macos-ios.sh` | One-time macOS/iOS dependencies installation |
| `scripts/setup-android-sdk.sh` | One-time Android SDK/NDK installation |
| `scripts/config.sh.template` | Template for signing credentials |

## Prerequisites

### 1. Rust Targets

```bash
rustup target add x86_64-apple-darwin      # macOS Intel
rustup target add aarch64-apple-darwin     # macOS ARM
rustup target add x86_64-unknown-linux-gnu # Linux
rustup target add x86_64-pc-windows-msvc   # Windows
rustup target add aarch64-linux-android    # Android ARM64
rustup target add armv7-linux-androideabi  # Android ARM
rustup target add i686-linux-android       # Android x86
rustup target add x86_64-linux-android     # Android x86_64
rustup target add aarch64-apple-ios        # iOS ARM64
rustup target add aarch64-apple-ios-sim    # iOS Simulator
```

### 2. GitHub CLI

```bash
brew install gh
gh auth login
```

### 3. Docker Desktop

Required for Linux and Windows builds from macOS. Download from [docker.com](https://www.docker.com/products/docker-desktop/).

### 4. Android SDK/NDK

Run the setup script:

```bash
./scripts/setup-android-sdk.sh
```

This installs:
- Android Command Line Tools
- Android SDK Platform 34
- Android NDK 26.1.10909125
- Build Tools 34.0.0

### 5. macOS/iOS Dependencies

Run the setup script to install all macOS and iOS build dependencies:

```bash
./scripts/setup-macos-ios.sh
```

This installs:
- `create-dmg` - DMG creation for macOS bundles
- `cocoapods` - iOS dependency manager
- `libimobiledevice` - iOS device communication
- `ios-deploy` - Deploy to iOS devices
- Rust targets for macOS and iOS

**Manual requirements:**
- Install Xcode from App Store
- Run `pnpm tauri ios init` to initialize iOS project

## Signing Configuration

Copy the template and fill in your credentials:

```bash
cp scripts/config.sh.template scripts/config.sh
```

### macOS Notarization

Required environment variables:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="your@email.com"
export APPLE_PASSWORD="app-specific-password"  # From appleid.apple.com
export APPLE_TEAM_ID="XXXXXXXXXX"
```

Get your signing identity:
```bash
security find-identity -v -p codesigning
```

Generate app-specific password at [appleid.apple.com](https://appleid.apple.com) > Security > App-Specific Passwords.

### Android Keystore

Create a keystore:

```bash
keytool -genkey -v -keystore scripts/containerus.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias containerus -storepass YOUR_PASSWORD
```

Environment variables:

```bash
export ANDROID_KEYSTORE="./scripts/containerus.jks"
export ANDROID_KEYSTORE_PASSWORD="your-password"
export ANDROID_KEY_ALIAS="containerus"
export ANDROID_KEY_PASSWORD="your-password"
```

### iOS Signing

- Requires Apple Developer Program ($99/year)
- Provisioning profile installed
- Distribution certificate in Keychain

```bash
export IOS_SIGNING_IDENTITY="Apple Distribution: Your Name (TEAMID)"
export IOS_TEAM_ID="XXXXXXXXXX"
export IOS_PROVISIONING_PROFILE="Your Profile Name"
```

## Usage

### Full Release

```bash
# Create a draft release (default, safest)
./scripts/release.sh 0.2.0

# Create and auto-publish release
./scripts/release.sh 0.2.0 --publish

# Preview without making changes
./scripts/release.sh 0.2.0 --dry-run

# Skip specific platforms
./scripts/release.sh 0.2.0 --skip-ios --skip-android

# Beta release
./scripts/release.sh 0.2.0-beta.1 --draft
```

### Release Options

| Option | Description |
|--------|-------------|
| `--skip-macos` | Skip macOS build |
| `--skip-linux` | Skip Linux build |
| `--skip-windows` | Skip Windows build |
| `--skip-android` | Skip Android build |
| `--skip-ios` | Skip iOS build |
| `--skip-publish` | Don't create GitHub release |
| `--draft` | Create draft release (default) |
| `--publish` | Auto-publish release |
| `--dry-run` | Preview without changes |

### Individual Platform Builds

```bash
# macOS (ARM64 + x64)
./scripts/build-macos.sh 0.2.0

# Linux (deb + AppImage)
./scripts/build-linux.sh 0.2.0

# Windows (exe + msi)
./scripts/build-windows.sh 0.2.0

# Android (APK)
./scripts/build-android.sh 0.2.0

# iOS (IPA)
./scripts/build-ios.sh 0.2.0
```

## Release Flow

```
./scripts/release.sh 0.2.0

Step 1: Validate & Prepare
├── Check version format (semver)
├── Check prerequisites (docker, gh, rust targets)
├── Load signing config
└── Update version in package.json, tauri.conf.json, Cargo.toml

Step 2: Build Frontend
└── pnpm build

Step 3: Build All Platforms
├── macOS ARM64 → containerus_0.2.0_macos_aarch64.dmg
├── macOS x64   → containerus_0.2.0_macos_x64.dmg
├── Linux x64   → containerus_0.2.0_linux_amd64.deb, .AppImage
├── Windows x64 → containerus_0.2.0_windows_x64-setup.exe
├── Android     → containerus_0.2.0_android.apk
└── iOS         → containerus_0.2.0_ios.ipa

Step 4: Generate Checksums
└── checksums.txt (SHA256)

Step 5: Create GitHub Release
├── git tag v0.2.0
├── git push --tags
├── gh release create v0.2.0 --draft
├── gh release upload v0.2.0 ./release/v0.2.0/*
└── Prompt: publish now? (y/n)
```

## Output Structure

```
release/
└── v0.2.0/
    ├── containerus_0.2.0_macos_aarch64.dmg
    ├── containerus_0.2.0_macos_x64.dmg
    ├── containerus_0.2.0_linux_amd64.deb
    ├── containerus_0.2.0_linux_amd64.AppImage
    ├── containerus_0.2.0_windows_x64-setup.exe
    ├── containerus_0.2.0_windows_x64.msi
    ├── containerus_0.2.0_android.apk
    ├── containerus_0.2.0_ios.ipa
    └── checksums.txt
```

## Docker Images

### Linux Build Image (`docker/Dockerfile.linux`)

Ubuntu 22.04 with:
- Rust toolchain
- Node.js + pnpm
- Tauri dependencies (webkit2gtk-4.1, etc.)
- AppImage tools

### Windows Build Image (`docker/Dockerfile.windows`)

Uses `cargo-xwin` for MSVC cross-compilation:
- Rust with Windows target
- cargo-xwin (downloads Windows SDK automatically)
- NSIS for installer creation

## Troubleshooting

### Docker not running

```
Docker is not running. Please start Docker Desktop.
```

Start Docker Desktop before running Linux or Windows builds.

### Missing Rust targets

The build scripts will automatically install missing targets, but you can install them manually:

```bash
rustup target add <target>
```

### macOS signing issues

Verify your signing identity:
```bash
security find-identity -v -p codesigning
```

### Android SDK not found

Run the setup script:
```bash
./scripts/setup-android-sdk.sh
source scripts/android-env.sh
```

### First Docker build is slow

The first build downloads SDKs and dependencies. Subsequent builds use the Docker cache and are much faster.

### iOS build fails with cocoapods error

If you see `failed to run command pod install`:
```bash
./scripts/setup-macos-ios.sh
```

Or install manually:
```bash
brew install cocoapods
pod setup
```

### DMG creation fails

Install `create-dmg`:
```bash
brew install create-dmg
```

## Notes

- First Docker build will be slow (downloading SDKs), subsequent builds use cache
- Windows cross-compilation may have limitations with some native dependencies
- iOS builds require active Apple Developer membership for distribution
- Keep `scripts/config.sh` in `.gitignore` (contains credentials)
- Release artifacts in `release/` are git-ignored

## Security

The following files contain sensitive credentials and are excluded from git:

- `scripts/config.sh` - Signing credentials
- `scripts/*.jks` - Android keystores
- `scripts/android-env.sh` - Generated by setup script

Never commit these files to version control.
