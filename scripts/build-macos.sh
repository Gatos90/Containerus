#!/bin/bash
# macOS Build Script for Containerus
# Builds ARM64 and x64 DMG files with optional signing and notarization

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="${1:-0.0.0}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Load configuration
CONFIG_FILE="$SCRIPT_DIR/config.sh"
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
    log_info "Loaded configuration from config.sh"
else
    log_warn "No config.sh found, signing will be skipped"
    SKIP_SIGNING="true"
fi

# Validate version
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    log_error "Invalid version format: $VERSION"
    log_error "Expected semver format (e.g., 1.0.0 or 1.0.0-beta.1)"
    exit 1
fi

log_info "Building Containerus v$VERSION for macOS..."
log_info "Project directory: $PROJECT_DIR"

cd "$PROJECT_DIR"

# Create output directory
OUTPUT_DIR="$PROJECT_DIR/release/v$VERSION"
mkdir -p "$OUTPUT_DIR"

# Check for required Rust targets
check_target() {
    if ! rustup target list --installed | grep -q "$1"; then
        log_info "Installing Rust target: $1"
        rustup target add "$1"
    fi
}

check_target "aarch64-apple-darwin"
check_target "x86_64-apple-darwin"

# Configure Tauri signing based on SKIP_SIGNING
TAURI_CONF="$PROJECT_DIR/src-tauri/tauri.conf.json"
TAURI_CONF_BACKUP="$PROJECT_DIR/src-tauri/tauri.conf.json.bak"

# Backup original config
cp "$TAURI_CONF" "$TAURI_CONF_BACKUP"

# Cleanup function to restore config
cleanup_tauri_conf() {
    if [[ -f "$TAURI_CONF_BACKUP" ]]; then
        mv "$TAURI_CONF_BACKUP" "$TAURI_CONF"
    fi
}
trap cleanup_tauri_conf EXIT

if [[ "$SKIP_SIGNING" == "true" || -z "$APPLE_SIGNING_IDENTITY" ]]; then
    log_info "Configuring Tauri to skip code signing..."
    # Unset the environment variable to prevent Tauri from using it
    unset APPLE_SIGNING_IDENTITY
    # Add macOS signingIdentity: null to disable signing
    if command -v jq &> /dev/null; then
        jq '.bundle.macOS = {"signingIdentity": null}' "$TAURI_CONF" > "$TAURI_CONF.tmp" && mv "$TAURI_CONF.tmp" "$TAURI_CONF"
    else
        log_error "jq is required to modify Tauri config. Install with: brew install jq"
        exit 1
    fi
else
    log_info "Configuring Tauri with signing identity: $APPLE_SIGNING_IDENTITY"
    if command -v jq &> /dev/null; then
        jq --arg identity "$APPLE_SIGNING_IDENTITY" '.bundle.macOS = {"signingIdentity": $identity}' "$TAURI_CONF" > "$TAURI_CONF.tmp" && mv "$TAURI_CONF.tmp" "$TAURI_CONF"
    else
        log_error "jq is required to modify Tauri config. Install with: brew install jq"
        exit 1
    fi
fi

# Build frontend first
log_info "Building frontend..."
pnpm install --frozen-lockfile || pnpm install
pnpm build

# Function to build for a specific architecture
build_arch() {
    local TARGET="$1"
    local ARCH_NAME="$2"

    log_info "Building for $ARCH_NAME ($TARGET)..."

    # Build with Tauri
    if [[ "$SKIP_SIGNING" == "true" ]]; then
        pnpm tauri build --target "$TARGET" --bundles dmg
    else
        # Set up signing environment
        export APPLE_SIGNING_IDENTITY="$APPLE_SIGNING_IDENTITY"
        pnpm tauri build --target "$TARGET" --bundles dmg
    fi

    # Find the built DMG
    local DMG_PATH=$(find "$PROJECT_DIR/src-tauri/target/$TARGET/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -1)

    if [[ -n "$DMG_PATH" && -f "$DMG_PATH" ]]; then
        local OUTPUT_NAME="containerus_${VERSION}_macos_${ARCH_NAME}.dmg"
        cp "$DMG_PATH" "$OUTPUT_DIR/$OUTPUT_NAME"
        log_success "Created: $OUTPUT_NAME"

        # Notarize if credentials are available
        if [[ "$SKIP_SIGNING" != "true" && "$SKIP_NOTARIZATION" != "true" && -n "$APPLE_ID" && -n "$APPLE_PASSWORD" && -n "$APPLE_TEAM_ID" ]]; then
            notarize_dmg "$OUTPUT_DIR/$OUTPUT_NAME"
        fi
    else
        log_error "DMG not found for $TARGET"
        # Try to find .app bundle instead
        local APP_PATH=$(find "$PROJECT_DIR/src-tauri/target/$TARGET/release/bundle/macos" -name "*.app" 2>/dev/null | head -1)
        if [[ -n "$APP_PATH" && -d "$APP_PATH" ]]; then
            log_info "Creating DMG from .app bundle..."
            local OUTPUT_NAME="containerus_${VERSION}_macos_${ARCH_NAME}.dmg"
            create_dmg "$APP_PATH" "$OUTPUT_DIR/$OUTPUT_NAME"
        else
            log_error "No bundle found for $TARGET"
            return 1
        fi
    fi
}

# Function to notarize a DMG
notarize_dmg() {
    local DMG_PATH="$1"
    local DMG_NAME=$(basename "$DMG_PATH")

    log_info "Submitting $DMG_NAME for notarization..."

    # Submit for notarization
    xcrun notarytool submit "$DMG_PATH" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait

    if [[ $? -eq 0 ]]; then
        log_info "Stapling notarization ticket..."
        xcrun stapler staple "$DMG_PATH"
        log_success "Notarization complete for $DMG_NAME"
    else
        log_error "Notarization failed for $DMG_NAME"
    fi
}

# Function to create DMG from .app
create_dmg() {
    local APP_PATH="$1"
    local OUTPUT_PATH="$2"
    local APP_NAME=$(basename "$APP_PATH" .app)
    local TEMP_DIR=$(mktemp -d)

    log_info "Creating DMG..."

    cp -R "$APP_PATH" "$TEMP_DIR/"
    ln -s /Applications "$TEMP_DIR/Applications"

    hdiutil create -volname "$APP_NAME" \
        -srcfolder "$TEMP_DIR" \
        -ov -format UDZO \
        "$OUTPUT_PATH"

    rm -rf "$TEMP_DIR"
    log_success "Created DMG: $OUTPUT_PATH"
}

# Build for both architectures
log_info "Starting macOS builds..."

# Detect current architecture for optimal build order
CURRENT_ARCH="$(uname -m)"
if [[ "$CURRENT_ARCH" == "arm64" ]]; then
    build_arch "aarch64-apple-darwin" "aarch64"
    build_arch "x86_64-apple-darwin" "x64"
else
    build_arch "x86_64-apple-darwin" "x64"
    build_arch "aarch64-apple-darwin" "aarch64"
fi

log_success "macOS builds complete!"
log_info "Output directory: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"/*.dmg 2>/dev/null || log_warn "No DMG files found"
