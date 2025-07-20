#!/usr/bin/env bash
#
# Test render Radarr Helm chart templates
# Usage: ./test-render.sh [environment]
#

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ENVIRONMENT="${1:-dev}"

echo "Testing template rendering for environment: $ENVIRONMENT"
echo "=================================================="

cd "$SCRIPT_DIR"

# Update dependencies first
echo "Updating dependencies..."
helm dependency update

# Test template rendering
if [[ "$ENVIRONMENT" == "prod" ]]; then
    values_file="values-prod.yaml"
else
    values_file="values.yaml"
fi

echo "Rendering templates with $values_file..."
helm template radarr . \
    --namespace lilnas-media \
    --values "$values_file" \
    --debug

echo ""
echo "Template rendering completed successfully!"