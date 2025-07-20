#!/usr/bin/env bash
#
# Deploy Radarr Helm chart to Kubernetes cluster
# Usage: ./deploy.sh [environment] [--dry-run]
#
# Environment options:
#   dev     - Deploy with development values (default)
#   prod    - Deploy with production values
#
# Options:
#   --dry-run    Show what would be deployed without actually deploying
#   --debug      Enable Helm debug output
#   --help       Show this help message
#

set -euo pipefail

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Script configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CHART_NAME="radarr"
readonly NAMESPACE="lilnas-media"
readonly DEFAULT_ENV="dev"

# Parse command line arguments
ENVIRONMENT="${1:-$DEFAULT_ENV}"
DRY_RUN=""
DEBUG=""
HELP=""

for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN="--dry-run"
            shift
            ;;
        --debug)
            DEBUG="--debug"
            shift
            ;;
        --help|-h)
            HELP="true"
            shift
            ;;
    esac
done

# Show help and exit
if [[ -n "$HELP" ]]; then
    echo "Deploy Radarr Helm chart to Kubernetes cluster"
    echo
    echo "Usage: $0 [environment] [--dry-run] [--debug] [--help]"
    echo
    echo "Environment options:"
    echo "  dev     Deploy with development values (default)"
    echo "  prod    Deploy with production values"
    echo
    echo "Options:"
    echo "  --dry-run    Show what would be deployed without actually deploying"
    echo "  --debug      Enable Helm debug output"
    echo "  --help       Show this help message"
    echo
    exit 0
fi

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|prod)$ ]]; then
    echo -e "${RED}Error: Invalid environment '$ENVIRONMENT'. Must be 'dev' or 'prod'${NC}"
    exit 1
fi

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

# Function to check prerequisites
check_prerequisites() {
    log "INFO" "Checking prerequisites..."
    
    # Check if helm is installed
    if ! command -v helm &> /dev/null; then
        log "ERROR" "Helm is not installed or not in PATH"
        exit 1
    fi
    
    # Check if kubectl is installed and configured
    if ! command -v kubectl &> /dev/null; then
        log "ERROR" "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Check if we can connect to the cluster
    if ! kubectl cluster-info &> /dev/null; then
        log "ERROR" "Cannot connect to Kubernetes cluster. Check your kubeconfig"
        exit 1
    fi
    
    log "SUCCESS" "Prerequisites check passed"
}

# Function to create namespace if it doesn't exist
ensure_namespace() {
    log "INFO" "Ensuring namespace '$NAMESPACE' exists..."
    
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log "INFO" "Creating namespace '$NAMESPACE'..."
        kubectl create namespace "$NAMESPACE"
        log "SUCCESS" "Namespace '$NAMESPACE' created"
    else
        log "INFO" "Namespace '$NAMESPACE' already exists"
    fi
}

# Function to update Helm dependencies
update_dependencies() {
    log "INFO" "Updating Helm chart dependencies..."
    
    cd "$SCRIPT_DIR"
    helm dependency update
    
    log "SUCCESS" "Dependencies updated"
}

# Function to deploy the chart
deploy_chart() {
    log "INFO" "Deploying Radarr chart with environment: $ENVIRONMENT"
    
    local values_file="values.yaml"
    if [[ "$ENVIRONMENT" == "prod" ]]; then
        values_file="values-prod.yaml"
    fi
    
    local helm_cmd="helm upgrade --install"
    helm_cmd="$helm_cmd $CHART_NAME ."
    helm_cmd="$helm_cmd --namespace $NAMESPACE"
    helm_cmd="$helm_cmd --create-namespace"
    helm_cmd="$helm_cmd --values $values_file"
    helm_cmd="$helm_cmd --wait"
    helm_cmd="$helm_cmd --timeout 300s"
    
    # Add optional flags
    if [[ -n "$DRY_RUN" ]]; then
        helm_cmd="$helm_cmd $DRY_RUN"
        log "INFO" "Running in dry-run mode - no changes will be made"
    fi
    
    if [[ -n "$DEBUG" ]]; then
        helm_cmd="$helm_cmd $DEBUG"
    fi
    
    log "INFO" "Executing: $helm_cmd"
    
    cd "$SCRIPT_DIR"
    eval "$helm_cmd"
    
    if [[ -z "$DRY_RUN" ]]; then
        log "SUCCESS" "Radarr deployed successfully!"
        
        # Show deployment status
        echo
        log "INFO" "Deployment status:"
        kubectl get pods -n "$NAMESPACE" -l "app.kubernetes.io/name=$CHART_NAME"
        
        echo
        log "INFO" "Service information:"
        kubectl get service -n "$NAMESPACE" -l "app.kubernetes.io/name=$CHART_NAME"
        
        echo
        log "INFO" "Ingress information:"
        kubectl get ingress -n "$NAMESPACE" -l "app.kubernetes.io/name=$CHART_NAME"
        
        echo
        log "SUCCESS" "Radarr should be available at: https://radarr.lilnas.io"
    else
        log "SUCCESS" "Dry run completed successfully!"
    fi
}

# Main execution
main() {
    log "INFO" "Starting Radarr deployment..."
    log "INFO" "Environment: $ENVIRONMENT"
    log "INFO" "Namespace: $NAMESPACE"
    
    check_prerequisites
    ensure_namespace
    update_dependencies
    deploy_chart
    
    log "SUCCESS" "Deployment script completed!"
}

# Run main function
main "$@"