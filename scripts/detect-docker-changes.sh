#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to log messages
log() {
    echo -e "${GREEN}[DETECT-DOCKER-CHANGES]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[DETECT-DOCKER-CHANGES]${NC} $1"
}

error() {
    echo -e "${RED}[DETECT-DOCKER-CHANGES]${NC} $1"
}

# Get list of changed files
get_changed_files() {
    if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
        # For PRs, compare against base branch
        git diff --name-only "origin/$GITHUB_BASE_REF"..HEAD
    else
        # For pushes to main, compare against previous commit
        git diff --name-only HEAD~1..HEAD
    fi
}

# Check if workflow files changed
check_workflow_changes() {
    local changed_files="$1"
    if echo "$changed_files" | grep -q "^\.github/workflows/\|^scripts/detect-docker-changes\.sh\|^infra/base-images/"; then
        return 0  # true
    else
        return 1  # false
    fi
}

# Get base images that need to be built
get_base_images() {
    local changed_files="$1"
    local base_images=()
    
    # Check if base image files changed
    if echo "$changed_files" | grep -q "^infra/base-images/lilnas-node-base\.Dockerfile\|^package\.json\|^pnpm-lock\.yaml"; then
        base_images+=("lilnas-node-base")
    fi
    
    if echo "$changed_files" | grep -q "^infra/base-images/lilnas-monorepo-builder\.Dockerfile\|^turbo\.json\|^pnpm-workspace\.yaml"; then
        base_images+=("lilnas-monorepo-builder")
    fi
    
    if echo "$changed_files" | grep -q "^infra/base-images/lilnas-node-runtime\.Dockerfile"; then
        base_images+=("lilnas-node-runtime")
    fi
    
    if echo "$changed_files" | grep -q "^infra/base-images/lilnas-nextjs-runtime\.Dockerfile"; then
        base_images+=("lilnas-nextjs-runtime")
    fi
    
    printf '%s\n' "${base_images[@]}"
}

# Get application images that need to be built
get_app_images() {
    local changed_files="$1"
    local app_images=()
    
    # Check each package directory for changes
    for pkg_dir in packages/*/; do
        if [ -d "$pkg_dir" ]; then
            pkg_name=$(basename "$pkg_dir")
            
            # Skip packages without Dockerfiles
            if [ ! -f "$pkg_dir/Dockerfile" ]; then
                continue
            fi
            
            # Check if any files in this package changed
            if echo "$changed_files" | grep -q "^packages/$pkg_name/"; then
                app_images+=("$pkg_name")
            fi
        fi
    done
    
    printf '%s\n' "${app_images[@]}"
}

# Main execution
main() {
    log "Detecting Docker image changes..."
    
    # Get changed files
    changed_files=$(get_changed_files)
    log "Changed files:"
    echo "$changed_files" | sed 's/^/  /'
    
    # Check if workflow files changed
    if check_workflow_changes "$changed_files"; then
        warn "Workflow or infrastructure files changed - will build all images"
        
        # Output all base images
        echo "base_images=[\"lilnas-node-base\",\"lilnas-monorepo-builder\",\"lilnas-node-runtime\",\"lilnas-nextjs-runtime\"]" >> "$GITHUB_OUTPUT"
        
        # Output all app images
        app_images=()
        for pkg_dir in packages/*/; do
            if [ -d "$pkg_dir" ]; then
                pkg_name=$(basename "$pkg_dir")
                if [ -f "$pkg_dir/Dockerfile" ]; then
                    app_images+=("$pkg_name")
                fi
            fi
        done
        
        if [ ${#app_images[@]} -eq 0 ]; then
            echo "app_images=[]" >> "$GITHUB_OUTPUT"
        else
            # Create JSON array
            json_array="["
            for i in "${!app_images[@]}"; do
                if [ $i -eq 0 ]; then
                    json_array+="\"${app_images[$i]}\""
                else
                    json_array+=",\"${app_images[$i]}\""
                fi
            done
            json_array+="]"
            echo "app_images=$json_array" >> "$GITHUB_OUTPUT"
        fi
    else
        # Get specific changed images
        base_images=($(get_base_images "$changed_files"))
        app_images=($(get_app_images "$changed_files"))
        
        # Output base images
        if [ ${#base_images[@]} -eq 0 ]; then
            echo "base_images=[]" >> "$GITHUB_OUTPUT"
        else
            json_array="["
            for i in "${!base_images[@]}"; do
                if [ $i -eq 0 ]; then
                    json_array+="\"${base_images[$i]}\""
                else
                    json_array+=",\"${base_images[$i]}\""
                fi
            done
            json_array+="]"
            echo "base_images=$json_array" >> "$GITHUB_OUTPUT"
        fi
        
        # Output app images
        if [ ${#app_images[@]} -eq 0 ]; then
            echo "app_images=[]" >> "$GITHUB_OUTPUT"
        else
            json_array="["
            for i in "${!app_images[@]}"; do
                if [ $i -eq 0 ]; then
                    json_array+="\"${app_images[$i]}\""
                else
                    json_array+=",\"${app_images[$i]}\""
                fi
            done
            json_array+="]"
            echo "app_images=$json_array" >> "$GITHUB_OUTPUT"
        fi
    fi
    
    log "Base images to build: ${base_images[*]}"
    log "App images to build: ${app_images[*]}"
}

# Run main function
main "$@"