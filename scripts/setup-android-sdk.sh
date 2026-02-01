#!/bin/bash
# Android SDK/NDK Setup Script for Containerus
# This script installs the Android SDK and NDK required for building Android APKs

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
CMDLINE_TOOLS_VERSION="11076708"  # Latest as of 2024
NDK_VERSION="26.1.10909125"
BUILD_TOOLS_VERSION="34.0.0"
PLATFORM_VERSION="34"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    log_error "This script is designed for macOS only"
    exit 1
fi

# Detect architecture
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
    CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-mac-${CMDLINE_TOOLS_VERSION}_latest.zip"
else
    CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-mac-${CMDLINE_TOOLS_VERSION}_latest.zip"
fi

log_info "Setting up Android SDK at: $ANDROID_HOME"
log_info "Architecture: $ARCH"

# Create Android SDK directory
mkdir -p "$ANDROID_HOME"

# Check if command line tools already exist
if [[ -d "$ANDROID_HOME/cmdline-tools/latest" ]]; then
    log_warn "Command line tools already installed, skipping download"
else
    log_info "Downloading Android Command Line Tools..."
    TEMP_DIR=$(mktemp -d)
    CMDLINE_TOOLS_ZIP="$TEMP_DIR/commandlinetools.zip"

    curl -L -o "$CMDLINE_TOOLS_ZIP" "$CMDLINE_TOOLS_URL"

    log_info "Extracting command line tools..."
    unzip -q "$CMDLINE_TOOLS_ZIP" -d "$TEMP_DIR"

    # Organize the tools in the expected structure
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    mv "$TEMP_DIR/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"

    rm -rf "$TEMP_DIR"
    log_success "Command line tools installed"
fi

# Set up PATH for sdkmanager
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

# Accept licenses
log_info "Accepting Android SDK licenses..."
yes | sdkmanager --licenses > /dev/null 2>&1 || true

# Install required packages
log_info "Installing Android SDK packages..."

# Platform tools (adb, etc.)
log_info "Installing platform-tools..."
sdkmanager "platform-tools"

# Build tools
log_info "Installing build-tools;$BUILD_TOOLS_VERSION..."
sdkmanager "build-tools;$BUILD_TOOLS_VERSION"

# Android platform
log_info "Installing platforms;android-$PLATFORM_VERSION..."
sdkmanager "platforms;android-$PLATFORM_VERSION"

# NDK
log_info "Installing NDK $NDK_VERSION (this may take a while)..."
sdkmanager "ndk;$NDK_VERSION"

# Add Rust Android targets
log_info "Adding Rust Android targets..."
rustup target add aarch64-linux-android || log_warn "Failed to add aarch64-linux-android target"
rustup target add armv7-linux-androideabi || log_warn "Failed to add armv7-linux-androideabi target"
rustup target add i686-linux-android || log_warn "Failed to add i686-linux-android target"
rustup target add x86_64-linux-android || log_warn "Failed to add x86_64-linux-android target"

# Create environment setup script
ENV_SCRIPT="$SCRIPT_DIR/android-env.sh"
cat > "$ENV_SCRIPT" << EOF
# Android SDK Environment Variables
# Source this file or add to your shell profile

export ANDROID_HOME="$ANDROID_HOME"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$NDK_VERSION"
export NDK_HOME="\$ANDROID_NDK_HOME"

# Add to PATH
export PATH="\$ANDROID_HOME/cmdline-tools/latest/bin:\$PATH"
export PATH="\$ANDROID_HOME/platform-tools:\$PATH"
export PATH="\$ANDROID_HOME/build-tools/$BUILD_TOOLS_VERSION:\$PATH"
EOF

log_success "Android SDK setup complete!"
echo ""
log_info "Environment variables written to: $ENV_SCRIPT"
log_info "Add the following to your shell profile (~/.zshrc or ~/.bashrc):"
echo ""
echo "  source $ENV_SCRIPT"
echo ""
log_info "Or add these exports manually:"
echo ""
echo "  export ANDROID_HOME=\"$ANDROID_HOME\""
echo "  export ANDROID_NDK_HOME=\"$ANDROID_HOME/ndk/$NDK_VERSION\""
echo ""

# Verify installation
log_info "Verifying installation..."
echo ""
echo "SDK Manager version:"
sdkmanager --version
echo ""
echo "Installed packages:"
sdkmanager --list_installed 2>/dev/null | head -20
echo ""

log_success "Setup complete! You can now build Android APKs."
