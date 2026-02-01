#!/bin/bash
# Android Build Script for Containerus
# Builds signed APK for Android devices

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

# Load Android environment if available
ANDROID_ENV="$SCRIPT_DIR/android-env.sh"
if [[ -f "$ANDROID_ENV" ]]; then
    source "$ANDROID_ENV"
    log_info "Loaded Android environment"
fi

# Validate version
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    log_error "Invalid version format: $VERSION"
    log_error "Expected semver format (e.g., 1.0.0 or 1.0.0-beta.1)"
    exit 1
fi

log_info "Building Containerus v$VERSION for Android..."
log_info "Project directory: $PROJECT_DIR"

cd "$PROJECT_DIR"

# Create output directory
OUTPUT_DIR="$PROJECT_DIR/release/v$VERSION"
mkdir -p "$OUTPUT_DIR"

# Check Android SDK
if [[ -z "$ANDROID_HOME" ]] || [[ ! -d "$ANDROID_HOME" ]]; then
    log_error "ANDROID_HOME is not set or directory does not exist"
    log_error "Run ./scripts/setup-android-sdk.sh first"
    exit 1
fi

if [[ -z "$ANDROID_NDK_HOME" ]] || [[ ! -d "$ANDROID_NDK_HOME" ]]; then
    log_error "ANDROID_NDK_HOME is not set or directory does not exist"
    log_error "Run ./scripts/setup-android-sdk.sh first"
    exit 1
fi

log_info "Using Android SDK: $ANDROID_HOME"
log_info "Using Android NDK: $ANDROID_NDK_HOME"

# Check for required Rust targets
check_target() {
    if ! rustup target list --installed | grep -q "$1"; then
        log_info "Installing Rust target: $1"
        rustup target add "$1"
    fi
}

check_target "aarch64-linux-android"
check_target "armv7-linux-androideabi"
check_target "i686-linux-android"
check_target "x86_64-linux-android"

# Initialize Tauri Android project if needed
if [[ ! -d "$PROJECT_DIR/src-tauri/gen/android" ]]; then
    log_info "Initializing Tauri Android project..."
    pnpm tauri android init
fi

# Create local.properties with SDK path for Gradle
LOCAL_PROPS="$PROJECT_DIR/src-tauri/gen/android/local.properties"
log_info "Configuring Android SDK path for Gradle..."
echo "sdk.dir=$ANDROID_HOME" > "$LOCAL_PROPS"
echo "ndk.dir=$ANDROID_NDK_HOME" >> "$LOCAL_PROPS"

# Install frontend dependencies
log_info "Installing dependencies..."
pnpm install --frozen-lockfile || pnpm install

# Build frontend
log_info "Building frontend..."
pnpm build

# Build Android APK
log_info "Building Android APK..."

# Determine signing configuration
if [[ -n "$ANDROID_KEYSTORE" && -f "$ANDROID_KEYSTORE" && -n "$ANDROID_KEYSTORE_PASSWORD" ]]; then
    log_info "Building signed release APK..."

    # Set up signing environment for Gradle
    export TAURI_ANDROID_KEYSTORE="$ANDROID_KEYSTORE"
    export TAURI_ANDROID_KEYSTORE_PASSWORD="$ANDROID_KEYSTORE_PASSWORD"
    export TAURI_ANDROID_KEY_ALIAS="${ANDROID_KEY_ALIAS:-containerus}"
    export TAURI_ANDROID_KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}"

    # Build release APK
    pnpm tauri android build --apk true

    # Find and sign the APK if not automatically signed
    APK_UNSIGNED=$(find "$PROJECT_DIR/src-tauri/gen/android/app/build/outputs/apk" -name "*-unsigned.apk" 2>/dev/null | head -1)
    if [[ -n "$APK_UNSIGNED" && -f "$APK_UNSIGNED" ]]; then
        log_info "Signing APK..."
        APK_SIGNED="${APK_UNSIGNED%-unsigned.apk}-signed.apk"

        # Sign with jarsigner
        jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
            -keystore "$ANDROID_KEYSTORE" \
            -storepass "$ANDROID_KEYSTORE_PASSWORD" \
            -keypass "$ANDROID_KEY_PASSWORD" \
            "$APK_UNSIGNED" "$ANDROID_KEY_ALIAS"

        # Align the APK
        ZIPALIGN="$ANDROID_HOME/build-tools/34.0.0/zipalign"
        if [[ -x "$ZIPALIGN" ]]; then
            "$ZIPALIGN" -v 4 "$APK_UNSIGNED" "$APK_SIGNED"
        else
            cp "$APK_UNSIGNED" "$APK_SIGNED"
            log_warn "zipalign not found, APK may not be optimized"
        fi

        OUTPUT_NAME="containerus_${VERSION}_android.apk"
        cp "$APK_SIGNED" "$OUTPUT_DIR/$OUTPUT_NAME"
        log_success "Created: $OUTPUT_NAME (signed)"
    fi
else
    log_warn "No keystore configured, building debug APK..."
    pnpm tauri android build --apk true --debug
fi

# Find and copy the built APK
log_info "Collecting build artifacts..."

# Look for release APK first
APK_RELEASE=$(find "$PROJECT_DIR/src-tauri/gen/android/app/build/outputs/apk/universal/release" -name "*.apk" 2>/dev/null | head -1)
if [[ -z "$APK_RELEASE" ]]; then
    APK_RELEASE=$(find "$PROJECT_DIR/src-tauri/gen/android/app/build/outputs/apk" -name "*release*.apk" 2>/dev/null | grep -v unsigned | head -1)
fi

if [[ -n "$APK_RELEASE" && -f "$APK_RELEASE" ]]; then
    OUTPUT_NAME="containerus_${VERSION}_android.apk"
    if [[ ! -f "$OUTPUT_DIR/$OUTPUT_NAME" ]]; then
        cp "$APK_RELEASE" "$OUTPUT_DIR/$OUTPUT_NAME"
        log_success "Created: $OUTPUT_NAME"
    fi
else
    # Fall back to debug APK
    APK_DEBUG=$(find "$PROJECT_DIR/src-tauri/gen/android/app/build/outputs/apk" -name "*debug*.apk" 2>/dev/null | head -1)
    if [[ -n "$APK_DEBUG" && -f "$APK_DEBUG" ]]; then
        OUTPUT_NAME="containerus_${VERSION}_android_debug.apk"
        cp "$APK_DEBUG" "$OUTPUT_DIR/$OUTPUT_NAME"
        log_warn "Created debug APK: $OUTPUT_NAME"
    else
        log_error "No APK found!"
        log_info "Checking build output directory:"
        find "$PROJECT_DIR/src-tauri/gen/android/app/build/outputs" -type f -name "*.apk" 2>/dev/null || echo "No APKs found"
    fi
fi

# Also check for AAB (Android App Bundle) for Play Store
AAB=$(find "$PROJECT_DIR/src-tauri/gen/android/app/build/outputs/bundle" -name "*.aab" 2>/dev/null | head -1)
if [[ -n "$AAB" && -f "$AAB" ]]; then
    OUTPUT_NAME="containerus_${VERSION}_android.aab"
    cp "$AAB" "$OUTPUT_DIR/$OUTPUT_NAME"
    log_success "Created: $OUTPUT_NAME (App Bundle for Play Store)"
fi

log_success "Android build complete!"
log_info "Output directory: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"/*android* 2>/dev/null || log_warn "No Android artifacts found"
