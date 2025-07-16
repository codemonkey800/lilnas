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
    local local_tag=$2
    local ghcr_tag=$3
    
    echo -e "${GREEN}Building ${local_tag}...${NC}"
    docker build -f "$BASE_DIR/$dockerfile" -t "$local_tag" -t "$ghcr_tag" "$BASE_DIR/../.." || {
        echo -e "${RED}Failed to build ${local_tag}${NC}"
        exit 1
    }
}

# Build base images in order
build_image "lilnas-node-base.Dockerfile" "lilnas-node-base:latest" "ghcr.io/codemonkey800/lilnas-node-base:latest"
build_image "lilnas-monorepo-builder.Dockerfile" "lilnas-monorepo-builder:latest" "ghcr.io/codemonkey800/lilnas-monorepo-builder:latest"
build_image "lilnas-node-runtime.Dockerfile" "lilnas-node-runtime:latest" "ghcr.io/codemonkey800/lilnas-node-runtime:latest"
build_image "lilnas-nextjs-runtime.Dockerfile" "lilnas-nextjs-runtime:latest" "ghcr.io/codemonkey800/lilnas-nextjs-runtime:latest"

echo -e "${GREEN}All base images built successfully!${NC}"
