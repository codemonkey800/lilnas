#!/bin/bash
set -e

# Source common functions
source "$(dirname "$0")/../../scripts/lib/common.sh"

# Configuration
APP_NAME="apps"

# Deploy the application
deploy_app