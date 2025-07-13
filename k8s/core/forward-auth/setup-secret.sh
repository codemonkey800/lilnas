#!/bin/bash

# Script: setup-secret.sh
# Purpose: Create a Kubernetes secret for forward-auth service
# Usage: ./setup-secret.sh --client-id <id> --client-secret <secret> --session-secret <secret>

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to display usage
usage() {
    cat << EOF
Usage: $0 --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET> --session-secret <SESSION_SECRET>

This script creates a Kubernetes secret for the forward-auth service.

Required flags:
  --client-id        OAuth client ID
  --client-secret    OAuth client secret
  --session-secret   Secret used for session encryption

Example:
  $0 --client-id "my-client-id" --client-secret "my-client-secret" --session-secret "random-session-secret"

EOF
    exit 1
}

# Function to print colored output
print_error() {
    echo -e "${RED}Error: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}Success: $1${NC}"
}

print_info() {
    echo -e "${YELLOW}Info: $1${NC}"
}

# Initialize variables
CLIENT_ID=""
CLIENT_SECRET=""
SESSION_SECRET=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --client-id)
            CLIENT_ID="$2"
            shift 2
            ;;
        --client-secret)
            CLIENT_SECRET="$2"
            shift 2
            ;;
        --session-secret)
            SESSION_SECRET="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Validate required arguments
if [[ -z "$CLIENT_ID" ]]; then
    print_error "Missing required flag: --client-id"
    usage
fi

if [[ -z "$CLIENT_SECRET" ]]; then
    print_error "Missing required flag: --client-secret"
    usage
fi

if [[ -z "$SESSION_SECRET" ]]; then
    print_error "Missing required flag: --session-secret"
    usage
fi

# Check if kubectl is installed
if ! command -v kubectl &> /dev/null; then
    print_error "kubectl is not installed or not in PATH"
    exit 1
fi

# Check if we can connect to the cluster
print_info "Checking Kubernetes cluster connection..."
if ! kubectl cluster-info &> /dev/null; then
    print_error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
    exit 1
fi

# Define secret name and namespace
SECRET_NAME="forward-auth-secrets"
NAMESPACE="lilnas-core"

# Check if namespace exists (you might want to change this to your specific namespace)
if [[ "$NAMESPACE" != "default" ]] && ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
    print_error "Namespace '$NAMESPACE' does not exist"
    exit 1
fi

# Check if secret already exists
if kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" &> /dev/null; then
    print_info "Secret '$SECRET_NAME' already exists in namespace '$NAMESPACE'"
    read -p "Do you want to update it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Operation cancelled"
        exit 0
    fi
    # Delete existing secret
    print_info "Deleting existing secret..."
    kubectl delete secret "$SECRET_NAME" -n "$NAMESPACE"
fi

# Create the secret
print_info "Creating Kubernetes secret '$SECRET_NAME' in namespace '$NAMESPACE'..."
if kubectl create secret generic "$SECRET_NAME" \
    --namespace="$NAMESPACE" \
    --from-literal=google-client-id="$CLIENT_ID" \
    --from-literal=google-client-secret="$CLIENT_SECRET" \
    --from-literal=secret="$SESSION_SECRET"; then
    
    print_success "Secret '$SECRET_NAME' created successfully!"
    
    # Display secret info
    print_info "Secret details:"
    kubectl describe secret "$SECRET_NAME" -n "$NAMESPACE" | grep -E "^Name:|^Namespace:|^Type:|^Data"
    
    # Provide usage example
    echo
    print_info "To use this secret in your forward-auth deployment, reference it like this:"
    cat << EOF

env:
  - name: PROVIDERS_GOOGLE_CLIENT_ID
    valueFrom:
      secretKeyRef:
        name: $SECRET_NAME
        key: google-client-id
  - name: PROVIDERS_GOOGLE_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: $SECRET_NAME
        key: google-client-secret
  - name: SECRET
    valueFrom:
      secretKeyRef:
        name: $SECRET_NAME
        key: secret
EOF
else
    print_error "Failed to create secret"
    exit 1
fi