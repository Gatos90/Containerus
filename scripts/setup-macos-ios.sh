#!/bin/bash
# macOS/iOS Development Setup Script for Containerus
# Installs all dependencies needed for building macOS and iOS apps

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    log_error "This script is for macOS only"
    exit 1
fi

log_info "Setting up macOS/iOS development environment..."
echo ""

# =============================================================================
# Xcode Command Line Tools
# =============================================================================
log_info "Checking Xcode Command Line Tools..."
if ! xcode-select -p &> /dev/null; then
    log_info "Installing Xcode Command Line Tools..."
    xcode-select --install
    echo ""
    log_warn "Please complete the Xcode Command Line Tools installation popup"
    log_warn "Then run this script again"
    exit 0
else
    log_success "Xcode Command Line Tools installed"
fi

# Check for full Xcode (required for iOS)
if [[ -d "/Applications/Xcode.app" ]]; then
    log_success "Xcode.app found"

    # Accept Xcode license if needed
    if ! sudo xcodebuild -license check &> /dev/null; then
        log_info "Accepting Xcode license..."
        sudo xcodebuild -license accept
    fi
else
    log_warn "Xcode.app not found - required for iOS builds"
    log_warn "Install from: App Store > Xcode"
fi

# =============================================================================
# Homebrew
# =============================================================================
log_info "Checking Homebrew..."
if ! command -v brew &> /dev/null; then
    log_info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add to PATH for Apple Silicon
    if [[ -f "/opt/homebrew/bin/brew" ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
else
    log_success "Homebrew installed"
fi

# =============================================================================
# Homebrew Packages
# =============================================================================
log_info "Installing Homebrew packages..."

BREW_PACKAGES=(
    "create-dmg"           # DMG creation for macOS bundles
    "cocoapods"            # iOS dependency manager
    "libimobiledevice"     # iOS device communication
    "ios-deploy"           # Deploy to iOS devices
    "ideviceinstaller"     # Install apps on iOS devices
)

for pkg in "${BREW_PACKAGES[@]}"; do
    if brew list "$pkg" &> /dev/null; then
        log_success "$pkg already installed"
    else
        log_info "Installing $pkg..."
        brew install "$pkg" || log_warn "Failed to install $pkg"
    fi
done

# =============================================================================
# CocoaPods Setup
# =============================================================================
log_info "Setting up CocoaPods..."
if command -v pod &> /dev/null; then
    log_success "CocoaPods available: $(pod --version)"

    # Setup CocoaPods repo if needed
    if [[ ! -d "$HOME/.cocoapods/repos/master" ]] && [[ ! -d "$HOME/.cocoapods/repos/trunk" ]]; then
        log_info "Setting up CocoaPods trunk repo (this may take a while)..."
        pod setup || log_warn "Pod setup failed - may work anyway with CDN"
    fi
else
    log_warn "CocoaPods not found after installation"
    log_info "Try installing with: sudo gem install cocoapods"
fi

# =============================================================================
# Rust Targets
# =============================================================================
log_info "Installing Rust targets for macOS and iOS..."

RUST_TARGETS=(
    "aarch64-apple-darwin"     # macOS ARM64 (Apple Silicon)
    "x86_64-apple-darwin"      # macOS x64 (Intel)
    "aarch64-apple-ios"        # iOS ARM64 (devices)
    "aarch64-apple-ios-sim"    # iOS Simulator (Apple Silicon)
    "x86_64-apple-ios"         # iOS Simulator (Intel)
)

for target in "${RUST_TARGETS[@]}"; do
    if rustup target list --installed | grep -q "$target"; then
        log_success "Rust target $target installed"
    else
        log_info "Installing Rust target: $target"
        rustup target add "$target" || log_warn "Failed to add $target"
    fi
done

# =============================================================================
# Tauri iOS Initialization
# =============================================================================
log_info "Checking Tauri iOS project..."
if [[ -d "$SCRIPT_DIR/../src-tauri/gen/apple" ]]; then
    log_success "Tauri iOS project already initialized"
else
    log_info "Tauri iOS project not initialized"
    log_info "Run 'pnpm tauri ios init' to initialize when ready"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=============================================="
log_success "macOS/iOS setup complete!"
echo "=============================================="
echo ""
echo "Installed tools:"
echo "  - create-dmg: $(command -v create-dmg &> /dev/null && echo 'OK' || echo 'MISSING')"
echo "  - cocoapods:  $(command -v pod &> /dev/null && pod --version || echo 'MISSING')"
echo "  - ios-deploy: $(command -v ios-deploy &> /dev/null && echo 'OK' || echo 'MISSING')"
echo ""
echo "Rust targets:"
for target in "${RUST_TARGETS[@]}"; do
    if rustup target list --installed | grep -q "$target"; then
        echo "  - $target: OK"
    else
        echo "  - $target: MISSING"
    fi
done
echo ""

# Check for iOS signing requirements
log_info "iOS Signing Requirements:"
echo "  1. Apple Developer Program membership (\$99/year)"
echo "  2. Create signing certificate in Xcode"
echo "  3. Create provisioning profile for your app"
echo "  4. Update scripts/config.sh with:"
echo "     - IOS_SIGNING_IDENTITY"
echo "     - IOS_TEAM_ID"
echo "     - IOS_PROVISIONING_PROFILE"
echo ""

log_info "Next steps:"
echo "  1. Run 'pnpm tauri ios init' to initialize iOS project"
echo "  2. Open Xcode and configure signing in the iOS project"
echo "  3. Test with: pnpm tauri ios dev"
echo ""
