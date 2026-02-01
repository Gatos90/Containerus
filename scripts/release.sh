#!/bin/bash
# Containerus Release Script
# Main orchestrator that builds all platforms and creates a GitHub release

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="${1:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "\n${CYAN}=== $1 ===${NC}\n"; }

# Show usage
usage() {
    echo "Usage: $0 <version> [options]"
    echo ""
    echo "Arguments:"
    echo "  version    Version number (semver format, e.g., 1.0.0 or 1.0.0-beta.1)"
    echo ""
    echo "Options:"
    echo "  --skip-macos     Skip macOS build"
    echo "  --skip-linux     Skip Linux build"
    echo "  --skip-windows   Skip Windows build"
    echo "  --skip-android   Skip Android build"
    echo "  --skip-ios       Skip iOS build"
    echo "  --skip-publish   Don't create GitHub release"
    echo "  --draft          Create draft release (don't auto-publish)"
    echo "  --dry-run        Don't make any changes, just show what would be done"
    echo ""
    echo "Examples:"
    echo "  $0 1.0.0                    # Full release of version 1.0.0"
    echo "  $0 1.0.0-beta.1 --draft     # Beta release as draft"
    echo "  $0 1.0.0 --skip-ios         # Skip iOS build"
    exit 1
}

# Parse arguments
SKIP_MACOS=false
SKIP_LINUX=false
SKIP_WINDOWS=false
SKIP_ANDROID=false
SKIP_IOS=false
SKIP_PUBLISH=false
CREATE_DRAFT=true  # Default to draft for safety
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-macos) SKIP_MACOS=true; shift ;;
        --skip-linux) SKIP_LINUX=true; shift ;;
        --skip-windows) SKIP_WINDOWS=true; shift ;;
        --skip-android) SKIP_ANDROID=true; shift ;;
        --skip-ios) SKIP_IOS=true; shift ;;
        --skip-publish) SKIP_PUBLISH=true; shift ;;
        --draft) CREATE_DRAFT=true; shift ;;
        --publish) CREATE_DRAFT=false; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --help|-h) usage ;;
        *)
            if [[ -z "$VERSION" ]]; then
                VERSION="$1"
            else
                log_error "Unknown option: $1"
                usage
            fi
            shift
            ;;
    esac
done

# Validate version
if [[ -z "$VERSION" ]]; then
    log_error "Version is required"
    usage
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    log_error "Invalid version format: $VERSION"
    log_error "Expected semver format (e.g., 1.0.0 or 1.0.0-beta.1)"
    exit 1
fi

# ============================================================================
# Step 1: Validate Prerequisites
# ============================================================================
log_step "Step 1: Validating Prerequisites"

cd "$PROJECT_DIR"

# Check git status
if [[ -n "$(git status --porcelain)" ]]; then
    log_warn "Working directory has uncommitted changes"
    if [[ "$DRY_RUN" == "false" ]]; then
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
fi

# Check for GitHub CLI
if ! command -v gh &> /dev/null; then
    log_error "GitHub CLI (gh) is not installed"
    log_error "Install with: brew install gh"
    exit 1
fi

# Check gh authentication
if ! gh auth status &> /dev/null; then
    log_error "Not authenticated with GitHub CLI"
    log_error "Run: gh auth login"
    exit 1
fi

# Check for Docker (needed for Linux/Windows builds)
if [[ "$SKIP_LINUX" == "false" || "$SKIP_WINDOWS" == "false" ]]; then
    if ! command -v docker &> /dev/null; then
        log_warn "Docker is not installed. Linux and Windows builds will be skipped."
        SKIP_LINUX=true
        SKIP_WINDOWS=true
    elif ! docker info &> /dev/null; then
        log_warn "Docker is not running. Linux and Windows builds will be skipped."
        SKIP_LINUX=true
        SKIP_WINDOWS=true
    fi
fi

# Check for Rust
if ! command -v rustc &> /dev/null; then
    log_error "Rust is not installed"
    log_error "Install from: https://rustup.rs"
    exit 1
fi

# Check for Node.js/pnpm
if ! command -v pnpm &> /dev/null; then
    log_error "pnpm is not installed"
    log_error "Install with: npm install -g pnpm"
    exit 1
fi

# Load configuration
CONFIG_FILE="$SCRIPT_DIR/config.sh"
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
    log_success "Loaded configuration from config.sh"
else
    log_warn "No config.sh found - signing will be skipped"
    log_info "Copy config.sh.template to config.sh and fill in your credentials"
fi

log_success "Prerequisites validated"

# ============================================================================
# Step 2: Update Version Numbers
# ============================================================================
log_step "Step 2: Updating Version Numbers"

if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would update version to $VERSION in:"
    log_info "  - package.json"
    log_info "  - src-tauri/tauri.conf.json"
    log_info "  - src-tauri/Cargo.toml"
else
    # Update package.json
    log_info "Updating package.json..."
    if command -v jq &> /dev/null; then
        jq ".version = \"$VERSION\"" package.json > package.json.tmp && mv package.json.tmp package.json
    else
        sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
    fi

    # Update tauri.conf.json
    log_info "Updating src-tauri/tauri.conf.json..."
    if command -v jq &> /dev/null; then
        jq ".version = \"$VERSION\"" src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
    else
        sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
    fi

    # Update Cargo.toml
    log_info "Updating src-tauri/Cargo.toml..."
    sed -i '' "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml

    log_success "Version updated to $VERSION"
fi

# ============================================================================
# Step 3: Build Frontend
# ============================================================================
log_step "Step 3: Building Frontend"

if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would run: pnpm install && pnpm build"
else
    log_info "Installing dependencies..."
    pnpm install --frozen-lockfile || pnpm install

    log_info "Building frontend..."
    pnpm build

    log_success "Frontend built"
fi

# ============================================================================
# Step 4: Build All Platforms
# ============================================================================
log_step "Step 4: Building All Platforms"

OUTPUT_DIR="$PROJECT_DIR/release/v$VERSION"
mkdir -p "$OUTPUT_DIR"

BUILD_FAILED=false

# macOS
if [[ "$SKIP_MACOS" == "false" ]]; then
    log_info "Building macOS..."
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would run: $SCRIPT_DIR/build-macos.sh $VERSION"
    else
        if "$SCRIPT_DIR/build-macos.sh" "$VERSION"; then
            log_success "macOS build complete"
        else
            log_error "macOS build failed"
            BUILD_FAILED=true
        fi
    fi
else
    log_info "Skipping macOS build"
fi

# Linux
if [[ "$SKIP_LINUX" == "false" ]]; then
    log_info "Building Linux..."
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would run: $SCRIPT_DIR/build-linux.sh $VERSION"
    else
        if "$SCRIPT_DIR/build-linux.sh" "$VERSION"; then
            log_success "Linux build complete"
        else
            log_error "Linux build failed"
            BUILD_FAILED=true
        fi
    fi
else
    log_info "Skipping Linux build"
fi

# Windows
if [[ "$SKIP_WINDOWS" == "false" ]]; then
    log_info "Building Windows..."
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would run: $SCRIPT_DIR/build-windows.sh $VERSION"
    else
        if "$SCRIPT_DIR/build-windows.sh" "$VERSION"; then
            log_success "Windows build complete"
        else
            log_error "Windows build failed"
            BUILD_FAILED=true
        fi
    fi
else
    log_info "Skipping Windows build"
fi

# Android
if [[ "$SKIP_ANDROID" == "false" ]]; then
    log_info "Building Android..."
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would run: $SCRIPT_DIR/build-android.sh $VERSION"
    else
        if "$SCRIPT_DIR/build-android.sh" "$VERSION"; then
            log_success "Android build complete"
        else
            log_error "Android build failed"
            BUILD_FAILED=true
        fi
    fi
else
    log_info "Skipping Android build"
fi

# iOS
if [[ "$SKIP_IOS" == "false" ]]; then
    log_info "Building iOS..."
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY RUN] Would run: $SCRIPT_DIR/build-ios.sh $VERSION"
    else
        if "$SCRIPT_DIR/build-ios.sh" "$VERSION"; then
            log_success "iOS build complete"
        else
            log_error "iOS build failed"
            BUILD_FAILED=true
        fi
    fi
else
    log_info "Skipping iOS build"
fi

# ============================================================================
# Step 5: Generate Checksums
# ============================================================================
log_step "Step 5: Generating Checksums"

if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would generate checksums for all artifacts"
else
    cd "$OUTPUT_DIR"
    if ls *.dmg *.deb *.AppImage *.exe *.msi *.apk *.ipa 2>/dev/null | head -1 > /dev/null; then
        log_info "Generating SHA256 checksums..."
        shasum -a 256 *.dmg *.deb *.AppImage *.exe *.msi *.apk *.ipa 2>/dev/null > checksums.txt || true
        log_success "Checksums written to checksums.txt"
        cat checksums.txt
    else
        log_warn "No artifacts found to generate checksums"
    fi
    cd "$PROJECT_DIR"
fi

# ============================================================================
# Step 6: Create GitHub Release
# ============================================================================
log_step "Step 6: Creating GitHub Release"

if [[ "$SKIP_PUBLISH" == "true" ]]; then
    log_info "Skipping GitHub release (--skip-publish)"
elif [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would create GitHub release v$VERSION"
    log_info "[DRY RUN] Would upload artifacts from: $OUTPUT_DIR"
else
    # Create git tag
    log_info "Creating git tag v$VERSION..."
    git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
    git commit -m "Release v$VERSION" || true  # May fail if no changes
    git tag -a "v$VERSION" -m "Release v$VERSION" 2>/dev/null || {
        log_warn "Tag v$VERSION already exists"
        read -p "Delete and recreate tag? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            git tag -d "v$VERSION"
            git tag -a "v$VERSION" -m "Release v$VERSION"
        fi
    }

    log_info "Pushing tag to origin..."
    git push origin "v$VERSION" --force

    # Prepare release notes
    RELEASE_NOTES=$(cat << EOF
## Containerus v$VERSION

### Downloads

| Platform | Architecture | File |
|----------|--------------|------|
| macOS | ARM64 (Apple Silicon) | containerus_${VERSION}_macos_aarch64.dmg |
| macOS | x64 (Intel) | containerus_${VERSION}_macos_x64.dmg |
| Linux | x64 | containerus_${VERSION}_linux_amd64.deb |
| Linux | x64 (AppImage) | containerus_${VERSION}_linux_amd64.AppImage |
| Windows | x64 | containerus_${VERSION}_windows_x64-setup.exe |
| Android | Universal | containerus_${VERSION}_android.apk |
| iOS | ARM64 | containerus_${VERSION}_ios.ipa |

### Checksums

See \`checksums.txt\` for SHA256 checksums of all files.

### Installation

**macOS**: Download the .dmg file for your architecture, open it, and drag Containerus to Applications.

**Linux**: Download the .deb file and install with \`sudo dpkg -i containerus_${VERSION}_linux_amd64.deb\`, or use the .AppImage directly.

**Windows**: Download the setup .exe and run the installer.

**Android**: Download the .apk and enable installation from unknown sources.

**iOS**: Requires TestFlight or enterprise distribution.
EOF
)

    # Create release
    log_info "Creating GitHub release..."
    DRAFT_FLAG=""
    if [[ "$CREATE_DRAFT" == "true" ]]; then
        DRAFT_FLAG="--draft"
        log_info "Creating as draft release"
    fi

    gh release create "v$VERSION" \
        --title "Containerus v$VERSION" \
        --notes "$RELEASE_NOTES" \
        $DRAFT_FLAG

    # Upload artifacts
    log_info "Uploading artifacts..."
    for file in "$OUTPUT_DIR"/*; do
        if [[ -f "$file" ]]; then
            log_info "Uploading: $(basename "$file")"
            gh release upload "v$VERSION" "$file" --clobber
        fi
    done

    log_success "GitHub release created!"

    # Show release URL
    RELEASE_URL=$(gh release view "v$VERSION" --json url -q .url)
    log_info "Release URL: $RELEASE_URL"

    if [[ "$CREATE_DRAFT" == "true" ]]; then
        echo ""
        log_info "Release is in DRAFT mode."
        read -p "Publish release now? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            gh release edit "v$VERSION" --draft=false
            log_success "Release published!"
        else
            log_info "Release remains as draft. Publish manually when ready."
        fi
    fi
fi

# ============================================================================
# Summary
# ============================================================================
log_step "Release Summary"

echo "Version: $VERSION"
echo "Output directory: $OUTPUT_DIR"
echo ""
echo "Artifacts:"
ls -la "$OUTPUT_DIR" 2>/dev/null || echo "  (no artifacts found)"
echo ""

if [[ "$BUILD_FAILED" == "true" ]]; then
    log_warn "Some builds failed. Check the logs above."
    exit 1
else
    log_success "Release process complete!"
fi
