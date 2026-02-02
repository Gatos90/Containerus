#!/bin/bash
# Linux Build Script for Containerus
# Uses Docker to build deb and AppImage packages

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="${1:-0.0.0}"
DOCKER_IMAGE="containerus-linux-builder"

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

log_info "Building Containerus v$VERSION for Linux..."
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
DOCKERFILE="$PROJECT_DIR/docker/Dockerfile.linux"
if [[ ! -f "$DOCKERFILE" ]]; then
    log_error "Dockerfile not found: $DOCKERFILE"
    exit 1
fi

log_info "Building Docker image: $DOCKER_IMAGE"
docker build -t "$DOCKER_IMAGE" -f "$DOCKERFILE" "$PROJECT_DIR/docker"

# Create a build script to run inside the container
BUILD_SCRIPT=$(cat << 'BUILDSCRIPT'
#!/bin/bash
set -e

cd /app

echo "[INFO] Installing dependencies..."
pnpm install --frozen-lockfile || pnpm install

echo "[INFO] Building frontend..."
pnpm build

echo "[INFO] Building Tauri app for Linux..."
cargo tauri build --bundles deb,appimage

echo "[INFO] Build complete!"
ls -la /app/src-tauri/target/release/bundle/
BUILDSCRIPT
)

# Run the build inside Docker
log_info "Running Linux build in Docker..."
docker run --rm \
    -v "$PROJECT_DIR:/app" \
    -v "$HOME/.cargo/registry:/root/.cargo/registry" \
    -v "$HOME/.cargo/git:/root/.cargo/git" \
    -e VERSION="$VERSION" \
    -e CI=true \
    "$DOCKER_IMAGE" \
    bash -c "$BUILD_SCRIPT"

# Copy artifacts to output directory
log_info "Collecting build artifacts..."

# Find and copy .deb files
DEB_DIR="$PROJECT_DIR/src-tauri/target/release/bundle/deb"
if [[ -d "$DEB_DIR" ]]; then
    for deb in "$DEB_DIR"/*.deb; do
        if [[ -f "$deb" ]]; then
            OUTPUT_NAME="containerus_${VERSION}_linux_amd64.deb"
            cp "$deb" "$OUTPUT_DIR/$OUTPUT_NAME"
            log_success "Created: $OUTPUT_NAME"
        fi
    done
fi

# Find and copy AppImage files
APPIMAGE_DIR="$PROJECT_DIR/src-tauri/target/release/bundle/appimage"
if [[ -d "$APPIMAGE_DIR" ]]; then
    for appimage in "$APPIMAGE_DIR"/*.AppImage; do
        if [[ -f "$appimage" ]]; then
            OUTPUT_NAME="containerus_${VERSION}_linux_amd64.AppImage"
            cp "$appimage" "$OUTPUT_DIR/$OUTPUT_NAME"
            chmod +x "$OUTPUT_DIR/$OUTPUT_NAME"
            log_success "Created: $OUTPUT_NAME"
        fi
    done
fi

# Check for RPM if built
RPM_DIR="$PROJECT_DIR/src-tauri/target/release/bundle/rpm"
if [[ -d "$RPM_DIR" ]]; then
    for rpm in "$RPM_DIR"/*.rpm; do
        if [[ -f "$rpm" ]]; then
            OUTPUT_NAME="containerus_${VERSION}_linux_amd64.rpm"
            cp "$rpm" "$OUTPUT_DIR/$OUTPUT_NAME"
            log_success "Created: $OUTPUT_NAME"
        fi
    done
fi

log_success "Linux build complete!"
log_info "Output directory: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"/*.deb "$OUTPUT_DIR"/*.AppImage 2>/dev/null || log_warn "No Linux artifacts found"
