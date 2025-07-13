#!/bin/bash
set -e

echo "Setting up Turbo Cache secrets for Kubernetes..."

# Parse command line arguments
usage() {
    echo "Usage: $0 --turbo-token <token> --aws-access-key <key> --aws-secret-key <secret> [--create]"
    echo "  --turbo-token      The Turbo token for authentication"
    echo "  --aws-access-key   AWS access key ID for MinIO/S3"
    echo "  --aws-secret-key   AWS secret access key for MinIO/S3"
    echo "  --create           Actually create the secret (without this flag, runs dry-run)"
    exit 1
}

TURBO_TOKEN=""
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""
CREATE_SECRET=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --turbo-token)
            TURBO_TOKEN="$2"
            shift 2
            ;;
        --aws-access-key)
            AWS_ACCESS_KEY_ID="$2"
            shift 2
            ;;
        --aws-secret-key)
            AWS_SECRET_ACCESS_KEY="$2"
            shift 2
            ;;
        --create)
            CREATE_SECRET=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Verify required variables are provided
if [ -z "$TURBO_TOKEN" ] || [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo "Error: Missing required arguments"
    echo "Required: --turbo-token, --aws-access-key, --aws-secret-key"
    echo ""
    usage
fi

echo "Arguments validated successfully"

# Create the Kubernetes secret
echo "Creating Kubernetes secret 'turbo-cache-secrets' in namespace 'lilnas-core'..."

if [ "$CREATE_SECRET" = true ]; then
    echo "Creating secret for real..."
    kubectl create secret generic turbo-cache-secrets \
        --namespace=lilnas-core \
        --from-literal=TURBO_TOKEN="$TURBO_TOKEN" \
        --from-literal=AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
        --from-literal=AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
    echo ""
    echo "Secret created successfully!"
else
    echo "Running with --dry-run=client for safety. Use --create flag to actually create the secret."
    kubectl create secret generic turbo-cache-secrets \
        --namespace=lilnas-core \
        --from-literal=TURBO_TOKEN="$TURBO_TOKEN" \
        --from-literal=AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
        --from-literal=AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
        --dry-run=client \
        -o yaml
    echo ""
    echo "Dry-run completed successfully!"
    echo "To actually create the secret, run with --create flag."
fi