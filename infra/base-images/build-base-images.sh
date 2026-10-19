#!/usr/bin/env bash
#
# Build the lilnas base images.
#
# CI (.github/workflows/ci.yml, job `base-images`) is the normal publisher of
# the four production images. This script is for local rebuilds and the
# one-time bootstrap of the GHCR packages.
#
# Usage:
#   ./infra/base-images/build-base-images.sh [--push] [--tag <sha>]
#
#   --push        push the four ghcr.io tags (needs a prior `docker login ghcr.io`)
#   --tag <sha>   additionally tag each production image as :<sha>
#
# Production images are tagged ghcr.io/codemonkey800/lilnas-<x>:latest and also
# keep the short local alias `lilnas-<x>` for anything still referencing it.
# `lilnas-dev` is built last, local-only, and never pushed.
set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

REGISTRY="ghcr.io/codemonkey800"

# Base directory; the build context is the repo root.
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT="$BASE_DIR/../.."

PUSH=false
SHA_TAG=""

usage() {
    echo "Usage: $0 [--push] [--tag <sha>]" >&2
    exit 1
}

while [ $# -gt 0 ]; do
    case "$1" in
        --push)
            PUSH=true
            shift
            ;;
        --tag)
            [ $# -ge 2 ] || usage
            SHA_TAG="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}" >&2
            usage
            ;;
    esac
done

echo "Building lilnas base Docker images..."

# Build a production base image: ghcr.io tag, local alias, optional :<sha>.
build_prod_image() {
    local name=$1
    local image="$REGISTRY/$name"
    local tags=(-t "$image:latest" -t "$name")

    if [ -n "$SHA_TAG" ]; then
        tags+=(-t "$image:$SHA_TAG")
    fi

    echo -e "${GREEN}Building ${image}:latest...${NC}"
    docker build -f "$BASE_DIR/$name.Dockerfile" "${tags[@]}" "$CONTEXT" || {
        echo -e "${RED}Failed to build ${image}${NC}"
        exit 1
    }
}

# Build a local-only image with just its short name.
build_local_image() {
    local name=$1

    echo -e "${GREEN}Building ${name}...${NC}"
    docker build -f "$BASE_DIR/$name.Dockerfile" -t "$name" "$CONTEXT" || {
        echo -e "${RED}Failed to build ${name}${NC}"
        exit 1
    }
}

push_image() {
    local name=$1
    local image="$REGISTRY/$name"

    echo -e "${GREEN}Pushing ${image}:latest...${NC}"
    docker push "$image:latest" || {
        echo -e "${RED}Failed to push ${image}:latest${NC}"
        exit 1
    }

    if [ -n "$SHA_TAG" ]; then
        echo -e "${GREEN}Pushing ${image}:${SHA_TAG}...${NC}"
        docker push "$image:$SHA_TAG" || {
            echo -e "${RED}Failed to push ${image}:${SHA_TAG}${NC}"
            exit 1
        }
    fi
}

# Build order matters: each image is FROM the previous one.
PROD_IMAGES=(
    lilnas-node-base
    lilnas-monorepo-builder
    lilnas-node-runtime
    lilnas-nextjs-runtime
)

for name in "${PROD_IMAGES[@]}"; do
    build_prod_image "$name"
done

# Dev-only runtime for the apps/*/deploy.dev.yml files. Not used by any
# production Dockerfile and never pushed.
build_local_image "lilnas-dev"

if [ "$PUSH" = true ]; then
    for name in "${PROD_IMAGES[@]}"; do
        push_image "$name"
    done
fi

echo -e "${GREEN}All base images built successfully!${NC}"
