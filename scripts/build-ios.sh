#!/bin/bash
# iOS Build Script for Containerus
# Builds signed IPA for iOS devices (requires Apple Developer Program membership)

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
fi

# Validate version
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    log_error "Invalid version format: $VERSION"
    log_error "Expected semver format (e.g., 1.0.0 or 1.0.0-beta.1)"
    exit 1
fi

log_info "Building Containerus v$VERSION for iOS..."
log_info "Project directory: $PROJECT_DIR"

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    log_error "iOS builds require macOS with Xcode installed"
    exit 1
fi

# Check for Xcode
if ! command -v xcodebuild &> /dev/null; then
    log_error "Xcode is not installed. Install from App Store."
    exit 1
fi

# Check Xcode command line tools
if ! xcode-select -p &> /dev/null; then
    log_error "Xcode command line tools not installed."
    log_error "Run: xcode-select --install"
    exit 1
fi

cd "$PROJECT_DIR"

# Create output directory
OUTPUT_DIR="$PROJECT_DIR/release/v$VERSION"
mkdir -p "$OUTPUT_DIR"

# Add iOS Rust targets
check_target() {
    if ! rustup target list --installed | grep -q "$1"; then
        log_info "Installing Rust target: $1"
        rustup target add "$1"
    fi
}

check_target "aarch64-apple-ios"
check_target "x86_64-apple-ios"
check_target "aarch64-apple-ios-sim"

# Initialize Tauri iOS project if needed
if [[ ! -d "$PROJECT_DIR/src-tauri/gen/apple" ]]; then
    log_info "Initializing Tauri iOS project..."
    pnpm tauri ios init
fi

# Install frontend dependencies
log_info "Installing dependencies..."
pnpm install --frozen-lockfile || pnpm install

# Build frontend
log_info "Building frontend..."
pnpm build

# Build iOS app
log_info "Building iOS app..."

# Check for signing identity
if [[ -n "$IOS_SIGNING_IDENTITY" ]]; then
    log_info "Building with signing identity: $IOS_SIGNING_IDENTITY"
    export CODE_SIGN_IDENTITY="$IOS_SIGNING_IDENTITY"
else
    log_warn "No iOS signing identity configured"
    log_warn "Build will proceed but may not be installable on devices"
fi

if [[ -n "$IOS_TEAM_ID" ]]; then
    export DEVELOPMENT_TEAM="$IOS_TEAM_ID"
fi

# Build the iOS app (release is default)
pnpm tauri ios build

# Find the built app
IOS_BUILD_DIR="$PROJECT_DIR/src-tauri/gen/apple/build"
APP_PATH=$(find "$IOS_BUILD_DIR" -name "*.app" -type d 2>/dev/null | head -1)

if [[ -n "$APP_PATH" && -d "$APP_PATH" ]]; then
    log_info "Found app bundle: $APP_PATH"

    # Create IPA from app bundle
    log_info "Creating IPA..."
    IPA_NAME="containerus_${VERSION}_ios.ipa"
    IPA_PATH="$OUTPUT_DIR/$IPA_NAME"

    # Create Payload directory structure
    PAYLOAD_DIR=$(mktemp -d)
    mkdir -p "$PAYLOAD_DIR/Payload"
    cp -R "$APP_PATH" "$PAYLOAD_DIR/Payload/"

    # Create IPA (which is just a zip file with .ipa extension)
    cd "$PAYLOAD_DIR"
    zip -r "$IPA_PATH" Payload
    cd "$PROJECT_DIR"

    rm -rf "$PAYLOAD_DIR"
    log_success "Created: $IPA_NAME"
else
    log_warn "App bundle not found in expected location"

    # Try to find xcarchive
    ARCHIVE_PATH=$(find "$IOS_BUILD_DIR" -name "*.xcarchive" -type d 2>/dev/null | head -1)
    if [[ -n "$ARCHIVE_PATH" && -d "$ARCHIVE_PATH" ]]; then
        log_info "Found archive: $ARCHIVE_PATH"

        # Export IPA from archive
        IPA_NAME="containerus_${VERSION}_ios.ipa"
        EXPORT_DIR=$(mktemp -d)

        # Create export options plist
        EXPORT_OPTIONS="$EXPORT_DIR/ExportOptions.plist"
        cat > "$EXPORT_OPTIONS" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>development</string>
    <key>teamID</key>
    <string>${IOS_TEAM_ID:-XXXXXXXXXX}</string>
    <key>compileBitcode</key>
    <false/>
    <key>stripSwiftSymbols</key>
    <true/>
</dict>
</plist>
EOF

        xcodebuild -exportArchive \
            -archivePath "$ARCHIVE_PATH" \
            -exportPath "$EXPORT_DIR" \
            -exportOptionsPlist "$EXPORT_OPTIONS" \
            2>/dev/null || log_warn "Export failed, manual export may be required"

        # Find exported IPA
        EXPORTED_IPA=$(find "$EXPORT_DIR" -name "*.ipa" 2>/dev/null | head -1)
        if [[ -n "$EXPORTED_IPA" && -f "$EXPORTED_IPA" ]]; then
            cp "$EXPORTED_IPA" "$OUTPUT_DIR/$IPA_NAME"
            log_success "Created: $IPA_NAME"
        else
            log_warn "IPA export failed. You may need to export manually from Xcode."
        fi

        rm -rf "$EXPORT_DIR"
    else
        log_error "No app bundle or archive found"
        log_info "Checking build directory:"
        find "$IOS_BUILD_DIR" -type d -maxdepth 3 2>/dev/null || echo "Build directory not found"

        log_info ""
        log_info "To build manually:"
        log_info "  1. Open Xcode project: open $PROJECT_DIR/src-tauri/gen/apple/*.xcodeproj"
        log_info "  2. Select your Team in Signing & Capabilities"
        log_info "  3. Build and archive from Product menu"
        log_info "  4. Export IPA from Organizer"
    fi
fi

log_success "iOS build complete!"
log_info "Output directory: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"/*ios* 2>/dev/null || log_warn "No iOS artifacts found"

log_info ""
log_info "Notes:"
log_info "  - iOS distribution requires Apple Developer Program membership (\$99/year)"
log_info "  - For App Store distribution, use Xcode Organizer to upload"
log_info "  - For TestFlight, archive and upload through App Store Connect"
log_info "  - For ad-hoc distribution, ensure devices are registered in your profile"
