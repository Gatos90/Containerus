#!/bin/bash
# Windows Build Script for Containerus
# Uses Docker with cargo-xwin for cross-compilation from macOS

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="${1:-0.0.0}"
DOCKER_IMAGE="containerus-windows-builder"

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

# Validate version
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    log_error "Invalid version format: $VERSION"
    log_error "Expected semver format (e.g., 1.0.0 or 1.0.0-beta.1)"
    exit 1
fi

log_info "Building Containerus v$VERSION for Windows..."
log_info "Project directory: $PROJECT_DIR"

# Check for Docker
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker Desktop."
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    log_error "Docker is not running. Please start Docker Desktop."
    exit 1
fi

cd "$PROJECT_DIR"

# Create output directory
OUTPUT_DIR="$PROJECT_DIR/release/v$VERSION"
mkdir -p "$OUTPUT_DIR"

# Build Docker image if it doesn't exist or is outdated
DOCKERFILE="$PROJECT_DIR/docker/Dockerfile.windows"
if [[ ! -f "$DOCKERFILE" ]]; then
    log_error "Dockerfile not found: $DOCKERFILE"
    exit 1
fi

log_info "Building Docker image: $DOCKER_IMAGE (this may take a while on first run)..."
docker build -t "$DOCKER_IMAGE" -f "$DOCKERFILE" "$PROJECT_DIR/docker"

# Create a build script to run inside the container
# Note: Windows cross-compilation with Tauri is complex due to WebView2 requirements
# This script builds the Rust backend, but the full Tauri bundle may need adjustments
BUILD_SCRIPT=$(cat << 'BUILDSCRIPT'
#!/bin/bash
set -e

cd /app

echo "[INFO] Installing frontend dependencies..."
pnpm install --frozen-lockfile || pnpm install

echo "[INFO] Building frontend..."
pnpm build

echo "[INFO] Building Tauri app for Windows..."
# Use cargo-xwin for the Rust compilation
cd /app/src-tauri
cargo xwin build --release --target x86_64-pc-windows-msvc

echo "[INFO] Rust build complete!"

# The Windows build produces an exe in the target directory
# For a full Tauri bundle with installer, additional NSIS configuration is needed
ls -la /app/src-tauri/target/x86_64-pc-windows-msvc/release/

echo "[INFO] Build complete!"
BUILDSCRIPT
)

# Run the build inside Docker
log_info "Running Windows build in Docker..."
log_warn "Note: Windows cross-compilation may have limitations with some native dependencies"

# Create xwin cache directory if it doesn't exist
mkdir -p "$HOME/.cache/cargo-xwin"

docker run --rm \
    -v "$PROJECT_DIR:/app" \
    -v "$HOME/.cargo/registry:/root/.cargo/registry" \
    -v "$HOME/.cargo/git:/root/.cargo/git" \
    -v "$HOME/.cache/cargo-xwin:/root/.cache/cargo-xwin" \
    -e VERSION="$VERSION" \
    -e CI=true \
    "$DOCKER_IMAGE" \
    bash -c "$BUILD_SCRIPT"

# Copy artifacts to output directory
log_info "Collecting build artifacts..."

# Find and copy .exe files
EXE_PATH="$PROJECT_DIR/src-tauri/target/x86_64-pc-windows-msvc/release/containerus.exe"
if [[ -f "$EXE_PATH" ]]; then
    OUTPUT_NAME="containerus_${VERSION}_windows_x64.exe"
    cp "$EXE_PATH" "$OUTPUT_DIR/$OUTPUT_NAME"
    log_success "Created: $OUTPUT_NAME"
else
    log_warn "Executable not found at expected path"
    # Try to find any .exe
    find "$PROJECT_DIR/src-tauri/target/x86_64-pc-windows-msvc/release" -maxdepth 1 -name "*.exe" -type f 2>/dev/null | while read exe; do
        BASENAME=$(basename "$exe")
        if [[ "$BASENAME" != "build-script-build.exe" ]]; then
            OUTPUT_NAME="containerus_${VERSION}_windows_x64.exe"
            cp "$exe" "$OUTPUT_DIR/$OUTPUT_NAME"
            log_success "Created: $OUTPUT_NAME (from $BASENAME)"
        fi
    done
fi

# Check for MSI installer (if Tauri bundler was able to create it)
MSI_DIR="$PROJECT_DIR/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi"
if [[ -d "$MSI_DIR" ]]; then
    for msi in "$MSI_DIR"/*.msi; do
        if [[ -f "$msi" ]]; then
            OUTPUT_NAME="containerus_${VERSION}_windows_x64.msi"
            cp "$msi" "$OUTPUT_DIR/$OUTPUT_NAME"
            log_success "Created: $OUTPUT_NAME"
        fi
    done
fi

# Check for NSIS installer
NSIS_DIR="$PROJECT_DIR/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"
if [[ -d "$NSIS_DIR" ]]; then
    for exe in "$NSIS_DIR"/*-setup.exe; do
        if [[ -f "$exe" ]]; then
            OUTPUT_NAME="containerus_${VERSION}_windows_x64-setup.exe"
            cp "$exe" "$OUTPUT_DIR/$OUTPUT_NAME"
            log_success "Created: $OUTPUT_NAME"
        fi
    done
fi

log_success "Windows build complete!"
log_info "Output directory: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"/*windows* 2>/dev/null || log_warn "No Windows artifacts found"

log_info ""
log_info "Note: For production Windows releases, consider:"
log_info "  - Code signing with a Windows Authenticode certificate"
log_info "  - Building on a native Windows machine for full compatibility"
log_info "  - Using GitHub Actions for official Windows builds"
