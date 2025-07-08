#!/bin/bash
set -e

echo "Building lilnas base Docker images..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Base directory
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Build function
build_image() {
    local dockerfile=$1
    local tag=$2
    
    echo -e "${GREEN}Building ${tag}...${NC}"
    docker build -f "$BASE_DIR/$dockerfile" -t "$tag" "$BASE_DIR/../.." || {
        echo -e "${RED}Failed to build ${tag}${NC}"
        exit 1
    }
}

# Build base images in order
build_image "lilnas-node-base.Dockerfile" "lilnas-node-base:latest"
build_image "lilnas-monorepo-builder.Dockerfile" "lilnas-monorepo-builder:latest"
build_image "lilnas-node-runtime.Dockerfile" "lilnas-node-runtime:latest"
build_image "lilnas-nextjs-runtime.Dockerfile" "lilnas-nextjs-runtime:latest"

echo -e "${GREEN}All base images built successfully!${NC}"
