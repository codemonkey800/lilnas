#!/bin/bash

set -e

# Script to detect changes that require Docker image rebuilds
# Based on the existing test.yml workflow patterns

# Applications with Dockerfiles
DOCKER_APPS=("apps" "dashcam" "download" "equations" "me-token-tracker" "tdr-bot")

# Base images
BASE_IMAGES=("lilnas-node-base" "lilnas-monorepo-builder" "lilnas-nextjs-runtime" "lilnas-node-runtime")

# Files that trigger base image rebuilds
BASE_IMAGE_FILES=(
  "infra/base-images/"
  "package.json"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
)

# Initialize arrays
CHANGED_BASE_IMAGES=()
CHANGED_APP_IMAGES=()
BASE_IMAGES_CHANGED=false

# Get list of changed files
if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
  # For PRs, compare against base branch
  CHANGED_FILES=$(git diff --name-only $GITHUB_BASE_SHA..$GITHUB_SHA)
else
  # For pushes to main, compare against previous commit
  CHANGED_FILES=$(git diff --name-only HEAD~1..HEAD)
fi

echo "Changed files:"
echo "$CHANGED_FILES"

# Check if workflow files changed
WORKFLOW_CHANGED=false
if echo "$CHANGED_FILES" | grep -q "^\.github/workflows/\|^\.github/scripts/"; then
  WORKFLOW_CHANGED=true
  echo "Workflow files changed - will rebuild all images"
fi

# Function to check if base images need rebuilding
check_base_images() {
  local needs_rebuild=false
  
  # Check if any base image trigger files changed
  for file_pattern in "${BASE_IMAGE_FILES[@]}"; do
    if echo "$CHANGED_FILES" | grep -q "^$file_pattern"; then
      needs_rebuild=true
      echo "Base image trigger file changed: $file_pattern"
      break
    fi
  done
  
  # If workflow changed or base image files changed, rebuild all base images
  if [ "$WORKFLOW_CHANGED" = "true" ] || [ "$needs_rebuild" = "true" ]; then
    BASE_IMAGES_CHANGED=true
    CHANGED_BASE_IMAGES=("${BASE_IMAGES[@]}")
    echo "Base images need rebuilding: ${CHANGED_BASE_IMAGES[@]}"
  fi
}

# Function to check which app images need rebuilding
check_app_images() {
  if [ "$WORKFLOW_CHANGED" = "true" ] || [ "$BASE_IMAGES_CHANGED" = "true" ]; then
    # If workflow changed or base images changed, rebuild all apps
    CHANGED_APP_IMAGES=("${DOCKER_APPS[@]}")
    echo "All app images need rebuilding due to workflow or base image changes"
  else
    # Check each app directory for changes
    for app in "${DOCKER_APPS[@]}"; do
      # Check if any files in this app package changed
      if echo "$CHANGED_FILES" | grep -q "^packages/$app/"; then
        # Check if package has Dockerfile
        if [ -f "packages/$app/Dockerfile" ]; then
          CHANGED_APP_IMAGES+=("$app")
          echo "App image needs rebuilding: $app"
        fi
      fi
    done
  fi
}

# Function to convert array to JSON
array_to_json() {
  local arr=("$@")
  if [ ${#arr[@]} -eq 0 ]; then
    echo "[]"
  else
    # Create JSON array
    local json_array="["
    for i in "${!arr[@]}"; do
      if [ $i -eq 0 ]; then
        json_array+="\"${arr[$i]}\""
      else
        json_array+=",\"${arr[$i]}\""
      fi
    done
    json_array+="]"
    echo "$json_array"
  fi
}

# Main logic
echo "Detecting Docker image changes..."

check_base_images
check_app_images

# Combine all changed images
ALL_CHANGED_IMAGES=()
ALL_CHANGED_IMAGES+=("${CHANGED_BASE_IMAGES[@]}")
ALL_CHANGED_IMAGES+=("${CHANGED_APP_IMAGES[@]}")

# Convert arrays to JSON
BASE_IMAGES_JSON=$(array_to_json "${CHANGED_BASE_IMAGES[@]}")
APP_IMAGES_JSON=$(array_to_json "${CHANGED_APP_IMAGES[@]}")
ALL_IMAGES_JSON=$(array_to_json "${ALL_CHANGED_IMAGES[@]}")

# Create final JSON output
JSON_OUTPUT=$(cat <<EOF
{
  "baseImagesChanged": $BASE_IMAGES_CHANGED,
  "baseImages": $BASE_IMAGES_JSON,
  "appImages": $APP_IMAGES_JSON,
  "allImages": $ALL_IMAGES_JSON
}
EOF
)

echo "Docker change detection results:"
echo "$JSON_OUTPUT"

# Set GitHub Actions outputs if running in CI
if [ -n "$GITHUB_OUTPUT" ]; then
  echo "baseImagesChanged=$BASE_IMAGES_CHANGED" >> "$GITHUB_OUTPUT"
  echo "baseImages=$BASE_IMAGES_JSON" >> "$GITHUB_OUTPUT"
  echo "appImages=$APP_IMAGES_JSON" >> "$GITHUB_OUTPUT"
  echo "allImages=$ALL_IMAGES_JSON" >> "$GITHUB_OUTPUT"
  echo "dockerChanges=$JSON_OUTPUT" >> "$GITHUB_OUTPUT"
fi

# Summary
echo ""
echo "Summary:"
echo "- Base images changed: $BASE_IMAGES_CHANGED"
echo "- Base images to rebuild: ${CHANGED_BASE_IMAGES[@]}"
echo "- App images to rebuild: ${CHANGED_APP_IMAGES[@]}"
echo "- Total images to rebuild: ${#ALL_CHANGED_IMAGES[@]}"