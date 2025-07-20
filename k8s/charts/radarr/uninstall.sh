#!/usr/bin/env bash
#
# Uninstall Radarr Helm chart from Kubernetes cluster
# Usage: ./uninstall.sh [--remove-data]
#
# Options:
#   --remove-data    Also delete persistent volume claims (WARNING: This deletes all data!)
#   --help          Show this help message
#

set -euo pipefail

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Configuration
readonly CHART_NAME="radarr"
readonly NAMESPACE="lilnas-media"

# Parse arguments
REMOVE_DATA=""
HELP=""

for arg in "$@"; do
    case $arg in
        --remove-data)
            REMOVE_DATA="true"
            shift
            ;;
        --help|-h)
            HELP="true"
            shift
            ;;
    esac
done

# Function to log messages
log() {
    local level="$1"
    shift
    local message="$*"
    
    case "$level" in
        "INFO")
            echo -e "${BLUE}[INFO]${NC} $message"
            ;;
        "SUCCESS")
            echo -e "${GREEN}[SUCCESS]${NC} $message"
            ;;
        "WARNING")
            echo -e "${YELLOW}[WARNING]${NC} $message"
            ;;
        "ERROR")
            echo -e "${RED}[ERROR]${NC} $message"
            ;;
    esac
}

# Show help
if [[ -n "$HELP" ]]; then
    echo "Uninstall Radarr Helm chart from Kubernetes cluster"
    echo
    echo "Usage: $0 [--remove-data] [--help]"
    echo
    echo "Options:"
    echo "  --remove-data    Also delete persistent volume claims (WARNING: This deletes all data!)"
    echo "  --help          Show this help message"
    echo
    exit 0
fi

# Confirmation for data removal
if [[ -n "$REMOVE_DATA" ]]; then
    echo -e "${RED}WARNING: You have requested to delete all persistent data!${NC}"
    echo "This will permanently delete:"
    echo "- Radarr configuration"
    echo "- Database"
    echo "- All persistent volume claims"
    echo
    read -p "Are you sure you want to continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log "INFO" "Operation cancelled"
        exit 0
    fi
fi

# Main uninstall function
uninstall_radarr() {
    log "INFO" "Starting Radarr uninstallation..."
    
    # Check if Helm release exists
    if helm list -n "$NAMESPACE" | grep -q "$CHART_NAME"; then
        log "INFO" "Uninstalling Helm release: $CHART_NAME"
        helm uninstall "$CHART_NAME" --namespace "$NAMESPACE"
        log "SUCCESS" "Helm release uninstalled"
    else
        log "WARNING" "Helm release '$CHART_NAME' not found in namespace '$NAMESPACE'"
    fi
    
    # Remove PVCs if requested
    if [[ -n "$REMOVE_DATA" ]]; then
        log "WARNING" "Removing persistent volume claims..."
        
        if kubectl get pvc -n "$NAMESPACE" -l "app.kubernetes.io/name=$CHART_NAME" &> /dev/null; then
            kubectl delete pvc -n "$NAMESPACE" -l "app.kubernetes.io/name=$CHART_NAME"
            log "SUCCESS" "Persistent volume claims deleted"
        else
            log "INFO" "No persistent volume claims found to delete"
        fi
    else
        log "INFO" "Persistent volume claims preserved (use --remove-data to delete)"
    fi
    
    # Show remaining resources
    log "INFO" "Checking for remaining resources..."
    
    if kubectl get all -n "$NAMESPACE" -l "app.kubernetes.io/name=$CHART_NAME" 2>/dev/null | grep -q "No resources found"; then
        log "SUCCESS" "All resources have been cleaned up"
    else
        log "INFO" "Remaining resources in namespace '$NAMESPACE':"
        kubectl get all -n "$NAMESPACE" -l "app.kubernetes.io/name=$CHART_NAME" 2>/dev/null || true
    fi
    
    log "SUCCESS" "Radarr uninstallation completed!"
}

# Execute uninstallation
uninstall_radarr